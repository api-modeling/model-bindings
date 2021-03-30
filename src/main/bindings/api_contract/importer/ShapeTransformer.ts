import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Md5} from "ts-md5/dist/md5";
import {AMFModelQueries as $amfModel} from "./AMFModelQueries";
import {IDGenerator} from "./IDGenerator";
import {VOCAB} from "../constants";

export interface TransformedShape {
    schema: meta.Entity|meta.Scalar,
    allowMultiple: boolean
}

/**
 * Transforms a the shapes in a base unit
 */
export class ShapeTransformer {
    private readonly parsed: meta.DataModel[] = []
    private readonly moduleUri: string;
    protected readonly baseUnit: amf.model.document.BaseUnit;
    protected readonly entities:meta.Entity[] = [];
    protected readonly idGenerator: IDGenerator;


    /**
     * Builds a new transformer for the provided base unit that will be added
     * to the data model module with the provided URI
     * @param moduleUri
     * @param baseUnit
     * @param idGenerator
     * @pram idGenerator shared id generator passed to recursively created ShapeTransformers
     * @param parsed
     */
    constructor(moduleUri: string, baseUnit: amf.model.document.BaseUnit, idGenerator: IDGenerator, parsed: meta.DataModel[] = []) {
        this.moduleUri = moduleUri;
        this.baseUnit = baseUnit;
        this.parsed = parsed;
        this.idGenerator = idGenerator
    }

    /**
     * Parses an AMF BaseUnit and generates one or more modules with associated data models for the modeling tool
     */
    public transformBaseUnitDataModel(): meta.DataModel[] {


        if (!this.parsed.find((dm) => dm.uuid === this.baseUnit.id)) {
            this.transformShapes();
            const dataModel = this.buildDataModel();
            if (dataModel) {
                this.parsed.push(dataModel);
            }
            this.baseUnit.references().forEach((ref) => {
                const referenceTransformer = new ShapeTransformer(this.moduleUri, ref, this.idGenerator, this.parsed);
                referenceTransformer.transformBaseUnitDataModel();
            })
        }
        return this.parsed;
    }

    /**
     * Parses all the shapes in an AMF BaseUnit as modeling entities
     */
    private transformShapes() {

        if (this.baseUnit instanceof amf.model.document.Module || this.baseUnit instanceof amf.model.document.Document) {
            const declarations = <amf.model.document.DeclaresModel>this.baseUnit;
            (declarations.declares || []).forEach((domainElement) => this.transformShape(domainElement, true))
        }

        if (this.baseUnit instanceof amf.model.domain.DataType) {
            const encoded = <amf.model.document.EncodesModel>this.baseUnit;
            this.transformShape(encoded.encodes, true)
        }
    }

    /**
     * Look for th kind of shape and transform it using the right transformation logic
     * @param domainElement
     * @param topLevel
     * @private
     */
    protected transformShape(domainElement: amf.model.domain.DomainElement, topLevel: boolean = false): meta.Entity|null {
        return this.withTransformedShape(domainElement, topLevel, (entity) => {
            if ($amfModel.isLink(domainElement)) {
                return this.transformShapeLink(domainElement)
            } else {
                if (domainElement instanceof amf.model.domain.NodeShape) {
                    return this.transformNodeShape(entity, <amf.model.domain.NodeShape>domainElement);
                } else if (domainElement instanceof amf.model.domain.UnionShape) {
                    return this.transformUnionShape(entity, <amf.model.domain.UnionShape>domainElement);
                } else if (domainElement instanceof amf.model.domain.AnyShape) {
                    return null;
                    // parsed = this.transformAnyShape(<amf.model.domain.AnyShape>domainElement, entities);
                }
                return null;
            }
        });
    }

    private transformUnionShape(entity: meta.Entity, unionShape: amf.model.domain.UnionShape) {
        entity.name = this.idGenerator.getShapeName(unionShape)
        const unionMembers = unionShape.anyOf
            .map((shape) => this.transformShape(shape))
            .filter((shape) => shape != null)
        entity.disjoint = <meta.Entity[]>unionMembers;
        return entity;
    }


    private transformShapeLink(domainElement: amf.model.domain.DomainElement) {
        const linkTarget = (<amf.model.domain.AnyShape>domainElement).linkTarget!.id;
        const linkName = (<amf.model.domain.AnyShape>domainElement).linkLabel!.value()
        const link = new meta.Entity(linkName);
        link.uuid = Md5.hashStr(linkTarget).toString();
        // @ts-ignore
        link['isLink'] = true;
        return link;
    }

    /**
     * Parses a generic AnyShape
     * @param uuid: string
     * @param anyShape
     */
    private transformAnyShape(uuid: string, anyShape: amf.model.domain.AnyShape) {
        const name = this.idGenerator.getShapeName(anyShape)
        const entity = new meta.Entity(name)
        entity.uuid = uuid;
        entity.displayName = anyShape.displayName.option
        entity.description = anyShape.description.option
        return entity;
    }

    /**
     * Parses an individual object shape and generates a modeling entity out of it
     * @param entity
     * @param nodeShape
     */
    private transformNodeShape(entity: meta.Entity, nodeShape: amf.model.domain.NodeShape): meta.Entity|null {
        entity.name = this.idGenerator.getShapeName(nodeShape)
        entity.displayName = nodeShape.displayName.option
        entity.description = nodeShape.description.option

        // Process extensions using the base shapes in the model
        if (nodeShape.inherits.length !== 0) {
            const extensions = nodeShape.inherits.map((baseShape) => {
                return this.transformShape(baseShape);
            }).filter((uuid) => uuid != null);
            if (extensions.length > 1) {
                // @todo
                throw new Error("More than one base shape not supported in entity dialect yet")
            }
            if (extensions.length === 1) {
                entity.extends = extensions[0]!
            }
        }

        // Let's classify properties in scalar that will become attributes and objects that will become associations
        // If we find a type of shape we don't support we will throw an error.
        let scalarProperties: (amf.model.domain.PropertyShape)[] = []
        let objectProperties: (amf.model.domain.PropertyShape)[] = []

        nodeShape.properties.forEach((property) => {
            // nil unions are a common pattern when instead of making something optional a X|nil union is used.
            // If this is a nil union, let's first transform it into an optional property with the not nil member
            if (property.range instanceof amf.model.domain.UnionShape && $amfModel.isNilUnion(property.range)) {
                const notNil = $amfModel.extractFromNilUnion(property.range);
                property.withRange(notNil).withMinCount(0);
            }
            if ($amfModel.isScalarShape(property.range)) {
                scalarProperties.push(property)
            } else if ($amfModel.isObjectShape(property.range)) {
                objectProperties.push(property)
            } else if (property.range instanceof amf.model.domain.ArrayShape) {
                let arrayShape = <amf.model.domain.ArrayShape>property.range;
                if ($amfModel.isScalarShape(arrayShape.items)) {
                    scalarProperties.push(property)
                } else if ($amfModel.isObjectShape(arrayShape.items)) {
                    objectProperties.push(property)
                } else if ($amfModel.isIgnoredShape(arrayShape.items)) {
                    return;
                } else {
                    // @todo
                    // throw new Error(`Unsupported property range array items shape ${arrayShape.items}`);
                    console.log(`Not supported type ${property.id} -> ${arrayShape.items}`)
                }
            } else if ($amfModel.isIgnoredShape(property.range)) {
                return;
            } else {
                // @todo
                // throw new Error(`Unsupported property range shape ${property.range}`);
                console.log(`Not supported type ${property.id} -> ${property.range}`)
            }
        });

        entity.attributes = scalarProperties.map((property) => {
            return this.transformScalarPropertyShape(property);
        });

        entity.associations = objectProperties.map((property) => {
            return this.transformObjectPropertyShape(property);
        });

        return entity;
    }


    protected transformScalarPropertyShape(property: amf.model.domain.PropertyShape): meta.Attribute {
        // lets get the final shape
        let shape = property.range;
        if (shape instanceof amf.model.domain.ArrayShape) {
            shape = (<amf.model.domain.ArrayShape>shape).items
        }
        if (shape.isLink) {
            shape = <amf.model.domain.Shape>shape.linkTarget
        }
        let scalarShape = <amf.model.domain.ScalarShape>shape;

        // let's compute the range
        let scalarRange: meta.Scalar;
        if (scalarShape.dataType.value() === VOCAB.XSD_STRING) {
            scalarRange = new meta.StringScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_INTEGER) {
            scalarRange = new meta.IntegerScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_FLOAT) {
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_BOOLEAN) {
            scalarRange = new meta.BooleanScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DATE_TIME) { // @todo format option
            scalarRange = new meta.DateTimeScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DATE) {
            scalarRange = new meta.DateScalar();
        } else if (scalarShape.dataType.value() === VOCAB.AML_DATE_TIME_ONLY) { // @todo format option
            scalarRange = new meta.DateTimeScalar()
        } else if (scalarShape.dataType.value() === VOCAB.XSD_TIME) {
            scalarRange = new meta.TimeScalar();
        } else if (scalarShape.dataType.value() === VOCAB.AML_NUMBER) {
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DOUBLE) { // @todo add type binding
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_LONG) { // @todo add type binding
            scalarRange = new meta.IntegerScalar();
        } else {
            throw new Error(`Unsupported scalar value ${scalarShape.dataType.value()}`) // @todo missing null, link, uri
        }

        // now we can create the attribute wrapper
        const name = this.idGenerator.getShapeName(property, "attribute")
        const attribute = new meta.Attribute(name, scalarRange)
        attribute.uuid = Md5.hashStr(property.id).toString();
        attribute.description = property.description.option;
        attribute.required = (property.minCount.option || 0) !== 0;
        attribute.allowMultiple = property.range instanceof amf.model.domain.ArrayShape;

        // @todo parse additional attributes for a property shape and add bindings
        return attribute;
    }

    private transformObjectPropertyShape(property: amf.model.domain.PropertyShape): meta.Association {
        // lets get the final shape
        let shape = property.range;
        if (shape instanceof amf.model.domain.ArrayShape) {
            shape = (<amf.model.domain.ArrayShape>shape).items
        }

        let range = this.transformShape(shape)

        if (range != null) {
            // now we can create the association wrapper
            const name = this.idGenerator.getShapeName(property, "association")
            const association = new meta.Association(name)
            association.uuid = Md5.hashStr(property.id).toString();
            association.description = property.description.option;
            association.required = (property.minCount.option || 0) !== 0;
            association.allowMultiple = property.range instanceof amf.model.domain.ArrayShape;
            association.target = this.associationLink(shape);
            // @todo parse additional attributes for a property shape and add bindings

            return association;
        } else {
            throw new Error(`Cannot create association with an empty target ${property.id}`)
        }
    }

    private associationLink(shape: amf.model.domain.Shape) {
        let id = shape.id;
        if (shape.isLink) {
            id = shape.linkTarget!.id;
        }
        const entity = new meta.Entity("")
        entity.uuid = Md5.hashStr(id).toString();
        return entity;
    }


    /**
     * Helper method used to check that the transformation logic is only invoked if the shape has not been transformed already
     * @param domainElement
     * @param topLevel
     * @param f
     * @private
     */
    private withTransformedShape(domainElement: amf.model.domain.DomainElement, topLevel: boolean, f:(entity: meta.Entity) => meta.Entity|null): meta.Entity|null {
        const uuid = Md5.hashStr(domainElement.id).toString();
        const alreadyTransformed = this.entities.find((e) => e.uuid === uuid);
        if (alreadyTransformed != null) {
            return alreadyTransformed;
        } else {
            const entity = new meta.Entity("")
            entity.uuid = uuid;
            // we add it here to prevent cycles
            this.entities.push(entity)

            const parsed = f(entity);
            //@ts-ignore
            if (parsed != null && !parsed['isLink']) {
                this.uniqueName(parsed)
                if (topLevel) {
                    // @ts-ignore
                    parsed['top_level'] = true
                }
                return parsed;
            //@ts-ignore
            } else if (parsed != null && parsed['isLink']) {
                this.removeTransformedShape(uuid)
                return parsed;
            } else {
                // null is returned, we need to remove the entity we generated
                const i = this.entities.findIndex((e) => e.uuid === uuid)
                if (i) {
                    this.entities.splice(i,1);
                }
                return entity;
            }
        }
    }

    protected removeTransformedShape(uuid: string) {
        const i = this.entities.findIndex((e) => e.uuid === uuid)
        // we don't want the link in the list of entities to be declared,
        // we just want to generate a link
        if (i != null) {
            this.entities.splice(i,1);
        }
    }

    private uniqueName(parsed: meta.Entity) {
        const names: {[name: string]: boolean} = {}
        this.entities.forEach((e) => names[e.name] = true)
        let c = 0;
        let name = parsed.name
        while (names[name]) {
            c++
            name = `${parsed.name}${c}`
        }
        if (c > 1) {
            parsed.name = name
            if (parsed.displayName != null) {
                parsed.displayName = `${parsed.displayName}${c}`
            }
            names[parsed.name] = true;
        }

        return parsed;
    }


    /**
     * Builds a new data model for the provided set of entities based on the
     * data of the BaseUnit being parsed
     * @protected
     */
    protected buildDataModel(): meta.DataModel|undefined {
        const name = this.baseUnit.location.split("/").reverse()[0];
        const dataModel = new meta.DataModel(this.moduleUri);
        dataModel.uuid = Md5.hashStr(this.baseUnit.id).toString();
        if (this.entities.length > 0) {
            dataModel.entities = this.entities;
            dataModel.name = name;
            dataModel.description = this.baseUnit.usage.option;
            // @ts-ignore
            dataModel['parsed'] = this.baseUnit;
            return dataModel;
        }
    }

}