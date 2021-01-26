import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {ExporterBaseUtils} from "../utils/ExporterBaseUtils";
import {VOCAB} from "./constants";
import {BindingScalarValue} from "@api-modeling/api-modeling-metadata";

interface Traversal {
    current: meta.Resource,
    remaining: meta.Resource[]
}

export class APIContractExporter extends ExporterBaseUtils {

    private pathCounter = 0;

    private readonly modules: meta.ModularityDialect[];
    private readonly dataModels: meta.DataModelDialect[];
    private readonly apiModels: meta.ApiModelDialect[];
    private readonly bindings: meta.ModelBindingsDialect[];

    private readonly baseUnitsIndex: { [id: string]: amf.model.document.BaseUnit } = {};
    private readonly baseUnitAliases: { [id: string]: string} = {};
    private readonly entitiesIndex: { [id: string]: meta.Entity } = {};
    private readonly entityToBaseUnitIndex: { [entityId: string]: string } = {};
    private readonly formatExtension: string;
    private readonly references: { [source: string]: amf.model.document.BaseUnit[]} = {};


    constructor(modules: meta.ModularityDialect[], dataModels: meta.DataModelDialect[], apiModels: meta.ApiModelDialect[], bindings: meta.ModelBindingsDialect[], formatExtension: string) {
        super()
        this.modules = modules;
        this.dataModels = dataModels;
        this.apiModels = apiModels;
        this.bindings = bindings;
        this.formatExtension = formatExtension;

        this.indexBindings(this.bindings)
    }

    export(): amf.model.document.BaseUnit[] {
        const dataModels = this.exportDataModels();
        const apiModels = this.exportApiModels();
        return dataModels.concat(apiModels);
    }

    exportDataModels(): amf.model.document.BaseUnit[] {
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

    exportApiModels(): amf.model.document.BaseUnit[] {
        const apiModels: meta.ApiModelDialect[] = this.findApiModelsToExport()
        // Index
        const baseUnits = apiModels.map(apiModelDialect => {
            const baseUnit = this.exportBaseUnit(apiModelDialect);
            const apiModel = apiModelDialect.encodedApiModel()!
            this.indexBaseUnit(baseUnit, apiModel)
            return baseUnit;
        });
        // Export
        apiModels.map((apiModelDialect) => {
            this.addEndpointsToBaseUnit(apiModelDialect)
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

    protected findApiModelsToExport() {
        return this.apiModels.filter((apiModelDialect) => {
            if (apiModelDialect.encodedApiModel()) {
                const apiModel = apiModelDialect.encodedApiModel()!;
                return this.findBinding(apiModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING) != null;
            } else {
                return false
            }
        });
    }


    protected exportDataModel(dataModelDialect: meta.DataModelDialect): amf.model.domain.DomainElement[] {
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
        } else if (entity.adapts != null) {
            const baseEntity = this.findEntityById(entity.adapts.id());
            return this.isNodeShape(baseEntity) || fieldNum > 0; // Object can extend Any
        } else {
            return fieldNum > 0
        }
    }

    private isUnionShape(entity: meta.Entity): boolean {
        return (entity.disjoint || []).length > 0;
    }

    private exportBaseUnit(dataModelDialect: meta.DataModelDialect) {
        let modelId: string;
        let modelName: string;

        // we know both exist
        if (dataModelDialect instanceof meta.ApiModelDialect) {
            // @ts-ignore
            modelId = dataModelDialect.encodedApiModel()?.id()
            modelName = dataModelDialect.encodedApiModel()?.name!
        } else {
            // @ts-ignore
            modelId = dataModelDialect.encodedDataModel()?.id()
            modelName = dataModelDialect.encodedDataModel()?.name!
        }

        const binding = this.findBinding(modelId, VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING)!

        // register the alias to support references from other specs
        const baseUnitAlias = this.toAlias(modelName);
        this.baseUnitAliases[modelId] = baseUnitAlias;

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
                baseUnit.withId(modelId);
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else if (value === "JSON Schema / RAML Fragment") {
                const baseUnit = new amf.model.domain.DataType();
                // @ts-ignore
                baseUnit.withId(modelId);
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else if (value === "JSON Schema / RAML Library") {
                const baseUnit = new amf.model.document.Module();
                // @ts-ignore
                baseUnit.withId(modelId);
                baseUnit.withLocation(this.computeLocation(dataModelDialect.location));
                return baseUnit;
            } else {
                throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) with unknown value for the parameter ${value}`);
            }
        } else {
            throw new Error(`API Contract Document type binding (${VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING}) with non scalar parameter`);
        }
    }

    /**
     * Generate an internal map from the entities in the model to the BaseUnit where it should be encoded.
     * Allow us to navigate between modeling tool models and the APIContract we are generating
     * @param baseUnit
     * @param dataModel
     */
    protected indexBaseUnit(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel|meta.ApiModel) {
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
        if (entity.adapts != null) { // @todo: merge both somehow
            entity = entity.adapts
        }

        let nodeShape = new amf.model.domain.NodeShape();
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
        const scalarShape = this.exportScalarRange(attribute.id(), attribute.range);
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

    /**
     * Transforms a scalar range for an object into a AMF ScalarShape
     * @param subjectId
     * @param scalar
     */
    private exportScalarRange(subjectId: string, scalar: meta.Scalar) {
        const scalarShape: amf.model.domain.ScalarShape = new amf.model.domain.ScalarShape();
        scalarShape.withId(subjectId + "_scalar");

        if (scalar instanceof meta.StringScalar) {
            scalarShape.withDataType(VOCAB.XSD_STRING)
        } else if (scalar instanceof  meta.IntegerScalar) {
            scalarShape.withDataType(VOCAB.XSD_INTEGER)
        } else if (scalar instanceof  meta.FloatScalar) {
            scalarShape.withDataType(VOCAB.XSD_FLOAT)
        } else if (scalar instanceof  meta.BooleanScalar) {
            scalarShape.withDataType(VOCAB.XSD_BOOLEAN)
        } else if (scalar instanceof  meta.DateTimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE_TIME)
        } else if (scalar instanceof  meta.DateScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE)
        } else if (scalar instanceof  meta.TimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_TIME)
        } else {
          throw new Error(`Unsupported model scalar ${scalar}`)
        }

        return scalarShape;
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

    private generateLink(source: string|null, target: string, sourceBaseUnitId: string|null = null): amf.model.domain.AnyShape {
        if (sourceBaseUnitId == null && source != null) {
            sourceBaseUnitId = this.entityToBaseUnitIndex[source];
        }
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
        } else if (sourceBaseUnitId != null) {
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
        } else {
            throw new Error("Cannot link target entity without a valid source base unit for the source");
        }
    }

    private toAlias(name: string) {
        return name.toLowerCase().replace(" ", "_").replace(".", "_");
    }

    private addEndpointsToBaseUnit(apiModelDialect: meta.ApiModelDialect) {
        const baseUnit = this.baseUnitsIndex[apiModelDialect.id]!
        if (baseUnit instanceof amf.model.document.Document) {
            const apiModel = apiModelDialect.encodedApiModel();
            const entities = (apiModel?.entities||[]).map((entity) => {
                if (entity.adapts != null) {
                    return this.generateLink(null, entity.adapts.id(), baseUnit.id)
                } else {
                    return this.exportDataEntity(entity);
                }
            });
            if (entities.length > 0) {
                baseUnit.withDeclares((baseUnit.declares || []).concat(entities))
            }
            const webApi = new amf.model.domain.WebApi();
            baseUnit.withEncodes(webApi);
            if (apiModel?.name) {
                webApi.withName(apiModel.name);
            }
            if (apiModel?.version) {
                webApi.withVersion(apiModel.version);
            }
            if (apiModel?.description) {
                webApi.withDescription(apiModel.description)
            }
            const entrypoint = apiModel?.entryPoint
            const nestedResources = apiModel?.resources || []
            if (entrypoint == null) {
                throw new Error("Cannot export API model without entry point resource");
            }
            const traversal: Traversal = {
                current: entrypoint,
                remaining: nestedResources
            }
            this.computeEndpoints(traversal, "", entities, webApi, baseUnit.id)
        } else {
            throw new Error(`Cannot export an API model as a ${baseUnit} base unit, only as a Document`)
        }
    }


    private addShapesToBaseUnit(dataModelDialect: meta.DataModelDialect) {
        const shapes = this.exportDataModel(dataModelDialect);
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
        if (location.endsWith(".json") || location.endsWith(".jsonld") || location.endsWith(".raml") || location.endsWith(".yaml")) {
            const parts = location.split(".")
            parts.pop()
            parts.push(this.formatExtension)
            return parts.join(".")
        } else {
            return location + "." + this.formatExtension
        }
    }

    /**
     * Transforms the graph of resources into a flat list of endpoints
     * It stops when all nodes in the resource graph has been processed.
     * @param nextResource
     * @param parentPath
     * @param remainingResources
     * @param processedResources
     * @param entities
     * @param webApi
     * @param baseUnitId
     */
    private computeEndpoints(traversal: Traversal, parentPath: string, entities: amf.model.domain.DomainElement[], webApi: amf.model.domain.WebApi, baseUnitId: string) {
        const opDisambg: {[key: string]: boolean} = {};
        const endpointsAcc: {[path: string]: amf.model.domain.Operation[]} = {};
        const endpointsParamsAcc: {[path: string]: amf.model.domain.Parameter[]} = {};
        const endpointModelingOpAcc: {[path: string]: meta.Operation[]} = {};

        const nextResource = traversal.current;
        const remainingResources = traversal.remaining;

        (nextResource.operations||[]).forEach((op) => {
            let operation = new amf.model.domain.Operation();
            operation.withId(op.id());
            if (op.name) {
                operation.withName(op.name)
            }
            if (op.description) {
                operation.withDescription(op.description)
            }

            // @todo: create annotations/extensions here for the standard operations
            // const customDomainProperties: amf.model.domain.CustomDomainProperty[] = [];

            // first compute a binding path for the operation
            let path = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_PATH_BINDING);
            if (path == null) {
                path = this.resourceToPath(nextResource.name || nextResource.displayName, parentPath);
            }

            // let's find the operation binding
            let method = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_METHOD_BINDING);
            let methodName = "Custom";

            if (op instanceof meta.CreateOperation) {
                if (method == null) {
                    method = "post"
                }
                /*
                if (statusCode == null) {
                    statusCode = "201"
                }
                 */
                methodName = "Create"
            } else if (op instanceof meta.DeleteOperation) {
                if (method == null) {
                    method = "delete"
                }
                methodName = "Delete"
            } else if (op instanceof meta.PatchOperation) {
                if (method == null) {
                    method = "patch"
                }
                methodName = "Patch"
            } else if (op instanceof meta.UpdateOperation) {
                if (method == null) {
                    method = "put"
                }
                methodName = "Update"
            } else if (op instanceof meta.ListOperation) {
                if (method == null) {
                    method = "get"
                }
                methodName = "List"
            } else if (op instanceof meta.ReadOperation) {
                if (method == null) {
                    method = "get"
                }
                methodName = "Read"
            } else {
                if (method == null && op.isMutation) {
                    method = "post"
                } else if (method == null) {
                    method = "get"
                }
                if (op.name) {
                    methodName = op.name
                } else if (op.isMutation) {
                    methodName = "CustomMutation"
                }

            }
            operation.withMethod(method.toLowerCase());

            let req = new amf.model.domain.Request().withId(op.id()+"/request");

            // compute input parameters
            const inputs = op.inputs||[];
            const pathParams: amf.model.domain.Parameter[] = [];
            if (inputs.length > 0) {
                // if there is at least one input I add the request to the operation
                operation.withRequest(req);

                const headerParams: amf.model.domain.Parameter[] = [];
                const queryParams: amf.model.domain.Parameter[] = [];
                const cookieParams: amf.model.domain.Parameter[] = [];
                let foundBody = false;
                let paramC = 0;
                (op.inputs || []).forEach((input) => {
                    let param = new amf.model.domain.Parameter()
                    if (input.name) {
                        param.withName(input.name);
                    } else {
                        paramC++;
                        param.withName("param" + paramC);
                    }
                    // id based on name
                    param.withId(req.id + "/" + param.name.value())

                    if (input.description) {
                        param.withDescription(input.description)
                    }
                    if (input.required) {
                        param.withRequired(input.required)
                    }
                    // shape
                    if (input.scalarRange) {
                        let shape: amf.model.domain.AnyShape = this.exportScalarRange(input.id(), input.scalarRange);
                        if (input.allowMultiple) {
                            const arrayShape = new amf.model.domain.ArrayShape();
                            arrayShape.withId(shape.id + "_array");
                            arrayShape.withItems(shape)
                            shape = arrayShape
                        }
                        param.withSchema(shape);
                    }
                    if (input.objectRange) { // this can only be a link in params
                       let shapeLink: amf.model.domain.AnyShape = this.generateLink(null, input.objectRange.id(), baseUnitId)
                        if (input.allowMultiple) {
                            const arrayShape = new amf.model.domain.ArrayShape();
                            arrayShape.withId(shapeLink.id + "_array");
                            arrayShape.withItems(shapeLink)
                            shapeLink = arrayShape
                        }
                        param.withSchema(shapeLink);
                    }

                    // append the parameter to the right binding
                    let parameterBinding = this.extractBindingScalarValue(input.id(), VOCAB.API_CONTRACT_OPERATION_PARAMETER_BINDING);
                    if (parameterBinding == null && input.objectRange != null) {
                        parameterBinding = "body";
                    } else if (parameterBinding == null) {
                        parameterBinding = "query";
                    }
                    switch (parameterBinding) {
                        case "header":
                            headerParams.push(param)
                            break;
                        case "query":
                            queryParams.push(param)
                            break;
                        case "cookie":
                            cookieParams.push(param)
                            break;
                        case "path":
                            param.withBinding("path")
                            pathParams.push(param)
                            break;
                        case "body":
                            if (foundBody) {
                                throw new Error(`Duplicated body found for operation '${op.id()}'`)
                            } else {
                                foundBody = true;
                                const payload = req.withPayload();
                                payload.withSchema(param.schema)
                            }
                            break;
                        default:
                            throw new Error("Unknown parameter HTTP binding " + parameterBinding);
                    }
                });

                if (headerParams.length > 0) {
                    req.withHeaders(headerParams);
                }
                if (queryParams.length > 0) {
                    req.withQueryParameters(queryParams);
                }
                if (cookieParams.length > 0) {
                    req.withCookieParameters(cookieParams)
                }
            }

            if (op.output) {
                let response = operation.withResponse(op.output.name || "response");
                let statusCode = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING) || "200";
                response.withId(operation.id + "/_response").withStatusCode(statusCode)
                const payload = response.withPayload().withId(response.id + "/payload");
                let mediaType = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING) || "application/json";
                payload.withMediaType(mediaType)

                // shape
                if (op.output.scalarRange) {
                    let shape: amf.model.domain.AnyShape = this.exportScalarRange(response.id, op.output.scalarRange);
                    if (op.output.allowMultiple) {
                        let arrayShape = new amf.model.domain.ArrayShape()
                        arrayShape.withId(shape.id + "_array");
                        arrayShape.withItems(shape)
                        shape = arrayShape
                    }
                    payload.withSchema(shape)
                }
                if (op.output.objectRange) { // this can only be a link in params
                    let shape: amf.model.domain.DomainElement;
                    if (op.output.objectRange.adapts != null) {
                        shape = this.generateLink(null, op.output!.objectRange.adapts.id(), baseUnitId)
                    } else {
                        shape = this.exportDataEntity(op.output.objectRange)
                    }
                    if (shape instanceof amf.model.domain.AnyShape) {
                        if (op.output.allowMultiple) {
                            let arrayShape = new amf.model.domain.ArrayShape()
                            arrayShape.withId(shape.id + "_array");
                            arrayShape.withItems(shape)
                            shape = arrayShape
                        }
                        payload.withSchema(<amf.model.domain.AnyShape>shape)
                    } else {
                        throw new Error("Cannot export operation output object range entity with UUID:" + op.output.objectRange.uuid)
                    }
                }
            } else if (method === "GET" && nextResource.schema != null || op.output != null) {
                let response = operation.withResponse("response");
                let statusCode = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING) || "200";
                response.withId(operation.id + "/_response").withStatusCode(statusCode);
                const payload = response.withPayload().withId(response.id + "/payload");
                let mediaType = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING) || "application/json";
                payload.withMediaType(mediaType);

                let shape;
                if (op.output != null && op.output!.objectRange != null && op.output!.objectRange.adapts != null) {
                    shape = this.generateLink(null, op.output!.objectRange.adapts.id(), baseUnitId)
                } else if (op.output && op.output!.objectRange != null) {
                    shape = this.generateLink(null, op.output!.objectRange.id(), baseUnitId)
                } else if (nextResource.schema && nextResource.schema.adapts) {
                    shape = this.generateLink(null, nextResource.schema.adapts.id(), baseUnitId)
                } else if (nextResource.schema != null) {
                    shape = this.exportDataEntity(nextResource.schema)
                }

                if (shape instanceof amf.model.domain.AnyShape) {
                    payload.withSchema(shape)
                } else {
                    throw new Error("Cannot export operation output object range for GET operation " + op.id())
                }
            }


            // We need to do this to avoid having duplicated HTTP methods in the same endpoint
            //----------------------------------------------------------------------------------
            // try to generate a unique path / method combination for the operation
            // we first directly the operation under the path
            // then we compose path with the operation name
            // then we counter path+operations names
            let pathParamsKey = pathParams.map((p) => p.name.value()).sort().join(".")
            let key = `${path}:${methodName}:${pathParamsKey}`
            let mCounter = 0;
            while (opDisambg[key]) {
                if (mCounter == 0) {
                    path = path + methodName
                } else {
                    mCounter++;
                    path = path + methodName + mCounter;
                }
                key = `${path}:${methodName}:${pathParamsKey}`;
            }
            pathParams.map(p => p.name.value()).sort().forEach((p) => {
                const v = `{${p}}`
                if (path?.indexOf(v) == -1) {
                    path = path + "_" + v // "_" instead of "/" to avoid clashes in paths
                }
            });
            opDisambg[key] = true;


            // assign the endpoint to the right resource path
            let endpointOperations = endpointsAcc[path] || [];
            endpointOperations.push(operation);
            endpointsAcc[path] = endpointOperations;
            // assign path params for the resource path
            endpointsParamsAcc[path] = pathParams;
            // assign the operations for this resource path
            let opsEndpoint = endpointModelingOpAcc[path] || [];
            opsEndpoint.push(op)
            endpointModelingOpAcc[path] = opsEndpoint;
        });


        Object.keys(endpointsAcc).map((path) => {
            const operations = endpointsAcc[path];
            // the endpoint might have been added in the recursive call for nested endpoints
            let endpoint = webApi.endPoints.find((ep) => ep.path.value() === path);
            if (endpoint == null) { // add the new endpoint
                endpoint = new amf.model.domain.EndPoint();
                endpoint
                    .withId(nextResource.id() + path.replace("/", "_"))
                    .withPath(path)
                const webApiAcc = webApi.endPoints || [];
                webApi.withEndPoints(webApiAcc.concat([endpoint]));
            }

            // update operations
            const oldOperations = endpoint.operations || [];
            endpoint.withOperations(oldOperations.concat(operations));

            const pathParams = endpointsParamsAcc[path]

            if (pathParams && pathParams.length != 0) {
                endpoint.withParameters(pathParams);
            }

            const endpointOps = endpointModelingOpAcc[path] || [];
            const transitions = endpointOps.map(op => op.transition).filter(t => t != null && t.target?.uuid != null);
            transitions.forEach(transition => {
               const targetResource = remainingResources.find(remainingResource => remainingResource.uuid == transition?.target?.uuid);
               if (targetResource) {
                   // prepare next invocation
                   traversal.current = targetResource;
                   traversal.remaining = remainingResources.filter(r => r.uuid != targetResource.uuid)
                   this.computeEndpoints(traversal, path, entities, webApi, baseUnitId);
               }
            });

            // return the endpoint
            return endpoint
        });


        // add the new endpoints
        if (traversal.remaining.length > 0) {
            traversal.current = traversal.remaining.shift()!;
            this.computeEndpoints(traversal, parentPath, entities, webApi, baseUnitId);
        }

    }

    private extractBindingScalarValue(source: string, declaration: string): string|undefined {
        const maybeBinding = this.findBinding(source, declaration)
        if (maybeBinding && maybeBinding.configuration && maybeBinding.configuration[0] instanceof BindingScalarValue) {
            const bindingValue = (<BindingScalarValue>maybeBinding.configuration[0]).lexicalValue
            return bindingValue
        }
    }
    /**
     * Transforms the name of the resource as a suffix path for the provided parent path
     * @param resourceName
     * @param parentPath
     */
    private resourceToPath(resourceName: string | undefined, parentPath: string) {
        if (resourceName == null) {
            resourceName = this.genPath();
        }

        const n = resourceName.replace(" ", "").replace("-", "")
        const components = n.split("/")
        const encodedPath = components.map((c) => encodeURIComponent(c)).join("/")

        return parentPath + "/" + encodedPath;
    }

    private genPath(): string {
        this.pathCounter++;
        return `path${this.pathCounter}`
    }
}