import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {ExporterBaseUtils} from "../utils/ExporterBaseUtils";
import {VOCAB} from "./constants";


export class APIContractExporter extends ExporterBaseUtils {

    private readonly modules: meta.ModularityDialect[];
    private readonly dataModels: meta.DataModelDialect[];
    private readonly bindings: meta.ModelBindingsDialect[];

    private readonly baseUnitsIndex: { [id: string]: amf.model.document.BaseUnit } = {};
    private readonly baseUnitAliases: { [id: string]: string} = {};
    private readonly entitiesIndex: { [id: string]: meta.Entity } = {};
    private readonly entityToBaseUnitIndex: { [entityId: string]: string } = {};
    private readonly formatExtension: string;
    private readonly references: { [source: string]: amf.model.document.BaseUnit[]} = {};

    constructor(modules: meta.ModularityDialect[], dataModels: meta.DataModelDialect[], bindings: meta.ModelBindingsDialect[], formatExtension: string) {
        super()
        this.modules = modules;
        this.dataModels = dataModels;
        this.bindings = bindings;
        this.formatExtension = formatExtension;

        this.indexBindings(this.bindings)
    }

    export(): amf.model.document.BaseUnit[] {
        const dataModels = this.findDataModelsToExport()
        // Index
        const baseUnits = dataModels.map(dataModelDialect => {
            const baseUnit = this.exportBaseUnit(dataModelDialect);
            this.indexBaseUnit(baseUnit, dataModelDialect.encodedDataModel()!)
            return baseUnit;
        });
        // Export
        dataModels.map((dataModelDialect) => {
            this.addShapesToBaseUnit(dataModelDialect)
        });
        // References
        baseUnits.forEach((baseUnit) => {
            const referenced = this.references[baseUnit.id]
            if (referenced != null) {
                baseUnit.withReferences(referenced)
                referenced.forEach((ref) => {
                    const alias = this.baseUnitAliases[ref.id]!;
                    baseUnit.withReferenceAlias(alias, ref.id, ref.location)
                });
            }
        });

        return baseUnits;
    }


    protected findDataModelsToExport() {
        return this.dataModels.filter((dataModelDialect) => {
            if (dataModelDialect.encodedDataModel()) {
                const dataModel = dataModelDialect.encodedDataModel()!;
                return this.findBinding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING) != null;
            } else {
                return false
            }
        });
    }


    protected exportModel(dataModelDialect: meta.DataModelDialect): amf.model.domain.DomainElement[] {
        const dataModel = dataModelDialect.encodedDataModel()!;
        const declarations: meta.Entity[] = (dataModel.entities || [])
        const shapesMap: { [id: string]: amf.model.domain.DomainElement } = {};
        return declarations.map(entity =>
            this.exportDataEntity(entity)
        )
    }

    private exportDataEntity(entity: meta.Entity): amf.model.domain.DomainElement {
        if (this.isNodeShape(entity)) {
            return this.exportNodeShape(entity);
        } else if (this.isUnionShape(entity)) {
            return this.exportUnionShape(entity);
        } else { // must be AnyShape
            return this.exportAnyShape(entity);
        }
    }


    private isNodeShape(entity: meta.Entity): boolean {
        const fieldNum = (entity.attributes || []).length + (entity.associations || []).length
        if (entity.extends != null) {
            const baseEntity = this.findEntityById(entity.extends.id());
            return this.isNodeShape(baseEntity) || fieldNum > 0; // Object can extend Any
        } else {
            return fieldNum > 0
        }
    }

    private isUnionShape(entity: meta.Entity): boolean {
        return (entity.disjoint || []).length > 0;
    }

    private exportBaseUnit(dataModelDialect: meta.DataModelDialect) {
        // we know both exist
        const dataModel = dataModelDialect.encodedDataModel()!
        const binding = this.findBinding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING)!

        // register the alias
        const baseUnitAlias = this.toAlias(dataModelDialect.encodedDataModel()!.name!)
        this.baseUnitAliases[dataModel.id()] = baseUnitAlias;

        const params: meta.BindingValue[] = (binding.configuration || []);
        if (params.length === 0) {
            throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) without parameters`);
        }
        if (params.length > 2) {
            throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) with more than 1 parameters`);
        }

        const bindingValue = this.findParam(params, VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING_PARAMETER)[0]
        if (bindingValue instanceof meta.BindingScalarValue) {
            const value = (<meta.BindingScalarValue>bindingValue).lexicalValue;
            if (value === "Open API Spec / RAML API Spec") {
                const baseUnit = new amf.model.document.Document();
                baseUnit.withId(dataModel.id());
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else if (value === "JSON Schema / RAML Fragment") {
                const baseUnit = new amf.model.domain.DataType();
                // @ts-ignore
                baseUnit.withId(dataModel.id());
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else if (value === "JSON Schema / RAML Library") {
                const baseUnit = new amf.model.document.Module();
                // @ts-ignore
                baseUnit.withId(dataModel.id());
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else {
                throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) with unknown value for the parameter ${value}`);
            }
        } else {
            throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) with non scalar parameter`);
        }
    }

    protected indexBaseUnit(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel) {
        this.baseUnitsIndex[baseUnit.id] = baseUnit;
        (dataModel.entities || []).forEach((entity) => {
            this.entityToBaseUnitIndex[entity.id()] = baseUnit.id;
            this.entitiesIndex[entity.id()] = entity;
        });
    }

    protected findEntityById(id: string): meta.Entity {
        const entity = this.entitiesIndex[id];
        if (entity != null) {
            return entity;
        } else {
            throw new Error(`Cannot find entity with id ${id}`);
        }
    }

    private exportNodeShape(entity: meta.Entity): amf.model.domain.NodeShape {
        const nodeShape = new amf.model.domain.NodeShape();
        nodeShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        nodeShape.withName(entity.name);
        if (entity.displayName != null) {
            nodeShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            nodeShape.withDescription(entity.description);
        }

        const scalarPropertyShapes: amf.model.domain.PropertyShape[] = (entity.attributes||[]).map((attribute) => {
            return this.exportAttribute(attribute);
        });

        const objectPropertyShapes: amf.model.domain.PropertyShape[] = (entity.associations || []).map((assoc) => {
            return this.exportAssociation(entity, assoc);
        });

        nodeShape.withProperties(scalarPropertyShapes.concat(objectPropertyShapes));

        if (entity.extends != null) {
            const baseLink = this.generateLink(entity.id(), entity.extends!.id());
            nodeShape.withInherits([baseLink]);
        }

        return nodeShape;
    }

    private exportUnionShape(entity: meta.Entity): amf.model.domain.UnionShape {
        const unionShape = new amf.model.domain.UnionShape();
        unionShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        unionShape.withName(entity.name);
        if (entity.displayName != null) {
            unionShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            unionShape.withDescription(entity.description);
        }

        const members = (entity.disjoint || []).map((unionEntity) => this.generateLink(entity.id(), unionEntity.id()));
        unionShape.withAnyOf(members);

        return unionShape;
    }

    private exportAnyShape(entity: meta.Entity): amf.model.domain.AnyShape {
        const anyShape = new amf.model.domain.AnyShape();
        anyShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        anyShape.withName(entity.name);
        if (entity.displayName != null) {
            anyShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            anyShape.withDescription(entity.description);
        }

        if (entity.extends != null) {
            const baseLink = this.generateLink(entity.id(), entity.extends!.id());
            anyShape.withInherits([baseLink]);
        }

        return anyShape;
    }

    /**
     * Transforms the attribute into a property shape with a scalar or
     * scalar array range.
     * @param attribute
     */
    private exportAttribute(attribute: meta.Attribute): amf.model.domain.PropertyShape {
        const scalarShape: amf.model.domain.ScalarShape = new amf.model.domain.ScalarShape();
        scalarShape.withId(attribute.id() + "_scalar");

        if (attribute.range instanceof meta.StringScalar) {
            scalarShape.withDataType(VOCAB.XSD_STRING)
        } else if (attribute.range instanceof  meta.IntegerScalar) {
            scalarShape.withDataType(VOCAB.XSD_INTEGER)
        } else if (attribute.range instanceof  meta.FloatScalar) {
            scalarShape.withDataType(VOCAB.XSD_FLOAT)
        } else if (attribute.range instanceof  meta.BooleanScalar) {
            scalarShape.withDataType(VOCAB.XSD_BOOLEAN)
        } else if (attribute.range instanceof  meta.DateTimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE_TIME)
        } else if (attribute.range instanceof  meta.DateScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE)
        } else if (attribute.range instanceof  meta.TimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_TIME)
        } else {
          throw new Error(`Unsupported model scalar ${attribute.range}`)
        }

        // The actual property shape
        const propertyShape: amf.model.domain.PropertyShape = new amf.model.domain.PropertyShape();
        propertyShape.withName(attribute.name)
        if (attribute.displayName) {
            propertyShape.withDisplayName(attribute.displayName)
        }
        if (attribute.description) {
            propertyShape.withDescription(attribute.description)
        }
        propertyShape.withId(attribute.id())

        // required
        if (attribute.required) {
            propertyShape.withMinCount(1);
        }
        // wrap in an array if the cardinality is N
        if (attribute.allowMultiple === true) {
            const arrayShape = new amf.model.domain.ArrayShape();
            arrayShape.withId(attribute.id() + "_array");
            arrayShape.withItems(scalarShape);
            propertyShape.withRange(arrayShape);
        } else {
            propertyShape.withRange(scalarShape);
        }

        return propertyShape
    }

    private exportAssociation(entity: meta.Entity, assoc: meta.Association): amf.model.domain.PropertyShape {
        const target = assoc.target;
        if (target != null) {
            const targetShape = this.generateLink(entity.id(), target!.id());

            // The actual property shape
            const propertyShape: amf.model.domain.PropertyShape = new amf.model.domain.PropertyShape();
            propertyShape.withId(assoc.id())
            propertyShape.withName(assoc.name)
            if (assoc.displayName) {
                propertyShape.withDisplayName(assoc.displayName)
            }
            if (assoc.description) {
                propertyShape.withDescription(assoc.description)
            }

            // required
            if (assoc.required) {
                propertyShape.withMinCount(1);
            }
            // wrap in an array if the cardinality is N
            if (assoc.allowMultiple === true) {
                const arrayShape = new amf.model.domain.ArrayShape();
                arrayShape.withId(assoc.id() + "_array");
                arrayShape.withItems(targetShape);
                propertyShape.withRange(arrayShape);
            } else {
                propertyShape.withRange(targetShape);
            }

            return propertyShape
        } else {
            throw new Error(`Cannot parse an association without target entity: ${assoc.id()}`)
        }
    }

    private generateLink(source: string, target: string): amf.model.domain.AnyShape {
        const sourceBaseUnitId = this.entityToBaseUnitIndex[source];
        const targetBaseUnitId = this.entityToBaseUnitIndex[target];
        const targetEntity = this.findEntityById(target)
        let targetShape: amf.model.domain.AnyShape | undefined;

        // This is just to generate the link. The actual shape will be parsed at a later stage (or might have already been parsed)
        if (this.isNodeShape(targetEntity)) {
            targetShape = new amf.model.domain.NodeShape().withId(target).withName(targetEntity.name);
        } else if (this.isUnionShape(targetEntity)) {
            targetShape = new amf.model.domain.UnionShape().withId(target).withName(targetEntity.name);
        } else {
            targetShape = new amf.model.domain.AnyShape().withId(target).withName(targetEntity.name);
        }

        if (targetBaseUnitId == null) {
            throw new Error(`Cannot link target entity without associated target base unit: ${target}`)
        } else {
            if (sourceBaseUnitId === targetBaseUnitId) {
                // local reference
                const link = targetShape.link();
                return <amf.model.domain.AnyShape>link.withLinkLabel(targetEntity.name);
            } else {
                // x-baseunit reference: include or library
                const targetBaseUnit = this.baseUnitsIndex[targetBaseUnitId];

                // index references
                const referenced = (this.references[sourceBaseUnitId] || [])
                if (!referenced.find((ref) => ref.id === targetBaseUnit.id)) {
                    referenced.push(targetBaseUnit)
                    this.references[sourceBaseUnitId] = referenced
                }

                // now generate the right kind of link
                if (targetBaseUnit instanceof amf.model.document.Module) {
                    // library
                    const link = targetShape.link();
                    const dataModelDialect = this.dataModels.find((dm) => dm.encodedDataModel()!.id() === targetBaseUnit.id)!
                    const alias = this.toAlias(dataModelDialect.encodedDataModel()!.name!)
                    return <amf.model.domain.AnyShape>link.withLinkLabel(`${alias}.${targetEntity.name}`)
                } else if (targetBaseUnit instanceof amf.model.domain.DataType) {
                    // fragment
                    const link = targetShape.link();
                    return <amf.model.domain.AnyShape>link.withLinkLabel(`!include ${targetBaseUnit.location}`); // @todo: setup the final URL for the generated unit ahead
                } else {
                    throw new Error(`Cannot reference base unit that is not a Fragment or a Module: ${targetBaseUnitId} from ${sourceBaseUnitId}`)
                }
            }
        }
    }

    private toAlias(name: string) {
        return name.toLowerCase().replace(" ", "_").replace(".", "_");
    }

    private addShapesToBaseUnit(dataModelDialect: meta.DataModelDialect) {
        const shapes = this.exportModel(dataModelDialect);
        const baseUnit = this.baseUnitsIndex[dataModelDialect.id]!
        if (baseUnit instanceof amf.model.document.Document) {
            (<amf.model.document.Document>baseUnit).withDeclares(shapes)
        } else if (baseUnit instanceof amf.model.document.Module) {
            (<amf.model.document.Module>baseUnit).withDeclares(shapes)
        } else {
            const binding = this.findBinding(dataModelDialect.encodedDataModel()!.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING)!
            const params: meta.BindingValue[] = (binding.configuration || []);
            const bindingValues = this.findParam(params, VOCAB.API_CONTRACT_DOCUMENT_TARGET_ENTITY_PARAMETER)
            if (bindingValues.length === 1) {
                const entity: meta.Entity = dataModelDialect.encodedDataModel()!.entities!.find((e) => e.name == (<meta.BindingScalarValue>bindingValues[0]).lexicalValue)!;
                const encodedShape = shapes.find((s) => {
                    return s.id === entity.id();
                })!;
                (<amf.model.domain.DataType>baseUnit).withEncodes(encodedShape)
            } else {
                throw new Error("Cannot generate data type fragment with multiple shapes");
            }
        }
    }

    private computeLocation(location: string) {
        if (location.indexOf(".") > -1) {
            const parts = location.split(".")
            parts.pop()
            parts.push(this.formatExtension)
            return parts.join(".")
        } else {
            return location + "." + this.formatExtension
        }
    }
}