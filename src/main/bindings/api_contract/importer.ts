import * as meta from "@api-modeling/api-modeling-metadata";
import {Scalar} from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Md5} from 'ts-md5/dist/md5';
import {VOCAB} from "./constants";
import assert from "assert";


export class APIContractImporter {

    private idGenerator = 0;
    // Resets the seed to generate identifiers
    protected resetAutoGen() {
        this.idGenerator = 0;
    }

    /**
     * Generates base unit bindings for the parsed BaseUnits in the API AMF model
     * @param baseUnit
     * @param dataModel
     */
    protected parseBaseUnitBindings(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel): meta.Binding {
        const binding = new meta.Binding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING);
        const param = new meta.BindingScalarValue();
        param.parameter = VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING_PARAMETER
        param.uuid = binding.uuid + "param";
        binding.uuid = `apiContract/bindings/DocumentTypeBinding/${dataModel.uuid}`

        // @ts-ignore
        if (baseUnit.declares != null && baseUnit.encodes != null) {
            param.lexicalValue = "Open API Spec / RAML API Spec"
            binding.configuration = [param]
        // @ts-ignore
        } else if (baseUnit.encodes != null) {
            param.lexicalValue = "JSON Schema / RAML Fragment"
            // Let's mark the entity encoded at the top level in the fragment
            // @ts-ignore
            const topLevel = (dataModel.entities||[]).find((e) => e['top_level'] === true)
            if (topLevel != null) { // @todo should we raise an error here?
                const targetEntityParameter = new meta.BindingScalarValue();
                targetEntityParameter.parameter = VOCAB.API_CONTRACT_DOCUMENT_TARGET_ENTITY_PARAMETER;
                targetEntityParameter.uuid = binding.uuid + "target_type_param"
                targetEntityParameter.lexicalValue = topLevel.name;
                binding.configuration = [param, targetEntityParameter]
            } else {
                binding.configuration = [param]
            }
        // @ts-ignore
        } else if (baseUnit.declares != null) {
            param.lexicalValue = "JSON Schema / RAML Library"
            binding.configuration = [param]
        }
        return binding;
    }

    /**
     * Parses an AMF BaseUnit and generates one or more modules with associated data models for the modeling tool
     * @param baseUnit
     */
    protected parseBaseUnitDataModel(moduleUri: string, baseUnit: amf.model.document.BaseUnit, parsed: meta.DataModel[] = []): meta.DataModel[] {
        const name = baseUnit.location.split("/").reverse()[0];

        if (!parsed.find((dm) => dm.uuid === baseUnit.id)) {
            const entities = this.parseShapes(baseUnit);
            const dataModel = new meta.DataModel(moduleUri);
            dataModel.uuid = Md5.hashStr(baseUnit.id).toString();
            dataModel.entities = entities;
            dataModel.name = name;
            dataModel.description = baseUnit.usage.option;
            // @ts-ignore
            dataModel['parsed'] = baseUnit;
            parsed.push(dataModel);
            baseUnit.references().map((ref) => {
                this.parseBaseUnitDataModel(moduleUri, ref, parsed);
            })
        }
        return parsed;
    }

    /**
     * Parses an AMF BaseUnit and generates one or more modules with associated data models for the modeling tool
     * @param moduleUri
     * @param baseUnit
     */
    protected parseBaseUnitApiModel(moduleUri: string, baseUnit: amf.model.document.Document, entityMap: {[id: string]: string}): meta.ApiModel {
        const webapi = <amf.model.domain.WebApi>baseUnit.encodes;
        const entrypoint = new meta.Resource();
        entrypoint.uuid = Md5.hashStr(webapi.id + "_entrypoint").toString()

        entrypoint.name = webapi.name.value();
        if (webapi.description.option) {
            entrypoint.description = webapi.description.value();
        }
        const endpoints: amf.model.domain.EndPoint[] = webapi.endPoints.sort((a,b) => {
            if (a.path.value().indexOf(b.path.value()) === 0) {
                return 1;
            } else {
                return -1;
            }
        });

        const accEntities: meta.Entity[] = [];
        const accResources: meta.Resource[] = [];

        this.parseResourceLinks(entrypoint, "", [], endpoints, accEntities, accResources, entityMap)


        const apiModel = new meta.ApiModel();
        apiModel.uuid = Md5.hashStr(webapi.id).toString();
        apiModel.entryPoint = entrypoint;

        apiModel.resources = accResources;
        apiModel.entities = accEntities;

        return apiModel;

    }

    private adaptOrCreate(schema: amf.model.domain.Shape, adaptedIdSuffix: string, accEntities: meta.Entity[],entityMap: {[id: string]: string}): meta.Entity|null {
        const schemaId = Md5.hashStr(schema.id).toString();
        const adaptedName = entityMap[schemaId];
        if (adaptedName) {
            const entity = new meta.Entity(adaptedName);
            entity.uuid = Md5.hashStr(schema.id + adaptedIdSuffix).toString();
            const link = new meta.Entity(adaptedName);
            link.uuid = schemaId;
            entity.adapts = link;
            return entity;
        } else {
            const parsed = this.parseShape(schema, accEntities)
            // @ts-ignore
            if (parsed != null && parsed['isLink']) {
                const entity = new meta.Entity(parsed.name);
                entity.uuid = Md5.hashStr(schema.id + adaptedIdSuffix).toString();
                entity.adapts = parsed;
                return entity;
            } else {
                return parsed;
            }
        }
    }

    private parseResource(endpoint: amf.model.domain.EndPoint, parent: string, pathParams: string[], group: amf.model.domain.EndPoint[], accEntities: meta.Entity[], accResources: meta.Resource[], entityMap: {[id: string]: string}): meta.Resource {
        const resource = new meta.Resource();
        accResources.push(resource);
        resource.operations = [];

        const getOperation = endpoint.operations.find((op) => op.method.value() === "get");
        let resp: amf.model.domain.Response|undefined;
        if (getOperation != null) {
            resp = getOperation.responses.find((r) => r.statusCode.value() === "200");
            if (resp == null) {
                resp = getOperation.responses.find((r) => r.statusCode.value().startsWith("2"));
            }
        }

        if (getOperation != null && resp != null) {
            const payload = resp.payloads.find((pl) => pl.schema != null)
            if (payload != null) {
                let effectiveShape = payload.schema
                if (effectiveShape instanceof amf.model.domain.ArrayShape) {
                    effectiveShape = (<amf.model.domain.ArrayShape>effectiveShape).items;
                    resource.isCollection = true
                }
                const entity = this.adaptOrCreate(effectiveShape, endpoint.id + "get", accEntities, entityMap)
                if (entity) {
                    resource.schema = entity
                } else {
                    throw new Error("Cannot process resource schema for endpoint " + endpoint.id)
                }
            }
        }
        const otherOperations = endpoint.operations.filter((op) => op.method.value() !== "get");
        if (otherOperations.length > 0) {
            otherOperations.forEach((op) => {
                const controlOperation = this.parseMutableOperation([], op, accEntities, entityMap);
                const method = op.method.value();
                let action = "Invoke"
                if (method == "post") {
                    action = 'Create'
                } else if (method === "put") {
                    action = 'Update'
                } else if (method === "delete") {
                    action = "Delete"
                } else if (method === "patch") {
                    action = 'Patch'
                } else {
                    action = op.method.value()
                }
                controlOperation.name = action

                resource.operations!.push(controlOperation)
            });
        }

        this.parseResourceLinks(resource, endpoint.path.value(), pathParams, group, accEntities, accResources, entityMap)

        resource.name = `Resource ${endpoint.path}`
        if (endpoint.description.option) {
            resource.description = endpoint.description.value()
        }
        return resource
    }

    protected parseResourceLinks(resource: meta.Resource, path: string, pathParams: string[], endpoints: amf.model.domain.EndPoint[], accEntities: meta.Entity[], accResources: meta.Resource[], entityMap: {[id: string]: string}): meta.Resource {
        if (endpoints.length > 0) {
            const groups: amf.model.domain.EndPoint[][] = [];
            let currentGroup: amf.model.domain.EndPoint[] = [];
            endpoints.forEach((ep) => {
                let current = currentGroup[0]
                const nestedPath = current == null || ep.path.value().indexOf(current.path.value()) == 0;
                const getOperation = ep.operations.find((op) => op.method.value() == "get") != null

                if ( nestedPath && getOperation) { // nested resource
                    currentGroup.push(ep)
                } else if (currentGroup.length > 0) { // nested operation over a nested resource
                    currentGroup.push(ep)
                } else { // nested operation over the top level resource
                    groups.push([ep]);
                    currentGroup = [];
                }
            });
            if (currentGroup.length > 0) {
                groups.push(currentGroup)
            }

            const operations: meta.Operation[] = [];

            groups.map((group) => {
                const linkedEndpoint = group.shift()!;
                const linkedEndpointOperations = (linkedEndpoint.operations || []);
                const getOperation = linkedEndpointOperations.find((op) => op.method.value() === "get")

                const newPathParams: amf.model.domain.Parameter[] = linkedEndpoint.parameters.filter((p: amf.model.domain.Parameter) => {
                    return !pathParams.includes(p.name.value())
                });


                // linked resource
                if (getOperation != null) {
                    const nestedResource = this.parseResource(linkedEndpoint, path, pathParams, group, accEntities, accResources, entityMap)
                    const linkOperation = this.parseGetOperation(newPathParams, getOperation, accEntities, entityMap)
                    linkOperation.name = `Find ${nestedResource.name}`

                    // setup the output parameter to the schema of the linked resource
                    // const outputParameter = new meta.OperationParameter();
                    // outputParameter.uuid = Md5.hashStr(getOperation.id + "output").toString();
                    // outputParameter.name = nestedResource.name;
                    // outputParameter.objectRange = nestedResource.schema;
                    // linkOperation.output = outputParameter;

                    // connect both resources through a transition
                    const transition = new meta.ResourceTransition();
                    transition.uuid = Md5.hashStr(getOperation.id + "transition").toString();
                    transition.target = nestedResource
                    linkOperation.transition = transition;

                    operations.push(linkOperation)

                } else  { // nested operations
                    assert(group.length === 0) // 0 because I have shifted the member
                    linkedEndpoint.operations.forEach((op)=> {
                        const controlOperation = this.parseMutableOperation(newPathParams, op, accEntities, entityMap);
                        const method = op.method.value();
                        let action = "Invoke"
                        if (method == "post") {
                            action = 'Create'
                        } else if (method === "put") {
                            action = 'Update'
                        } else if (method === "delete") {
                            action = "Delete"
                        } else if (method === "patch") {
                            action = 'Patch'
                        }

                        let pathFragment = linkedEndpoint.path.value().replace(path, "")
                        if (pathFragment.startsWith("/")) {
                            pathFragment = pathFragment.substring(1)
                        }
                        controlOperation.name = `${action} ${pathFragment}`

                        operations.push(controlOperation)
                    }) ;
                }
            });

            const oldOperations = resource.operations || [];
            resource.operations = oldOperations.concat(operations);
        }

        return resource;
    }

    private parseGetOperation(newPathParams: amf.model.domain.Parameter[], apiOperation: amf.model.domain.Operation, acc: meta.Entity[], entityMap: {[id: string]: string}): meta.Operation {
        const operation = new meta.ReadOperation();
        operation.uuid = Md5.hashStr(apiOperation.id).toString();
        operation.isMutation = false;

        let toParseParams = newPathParams;
        if (apiOperation.request != null && apiOperation.request.queryParameters != null) {
            toParseParams = toParseParams.concat(apiOperation.request.queryParameters)
        }
        operation.inputs = toParseParams.map((p) => {
            return this.parseParameter(p, acc, entityMap)
        });

        return operation;
    }

    private parseMutableOperation(newPathParams: amf.model.domain.Parameter[], apiOperation: amf.model.domain.Operation, acc: meta.Entity[], entityMap: {[id: string]: string}): meta.Operation {
        const operation = new meta.UpdateOperation();
        operation.uuid = Md5.hashStr(apiOperation.id).toString();
        operation.isMutation = true;

        let toParseParams = newPathParams;
        if (apiOperation.request != null && apiOperation.request.queryParameters != null) {
            toParseParams = toParseParams.concat(apiOperation.request.queryParameters)
        }
        operation.inputs = toParseParams.map((p) => {
            return this.parseParameter(p, acc, entityMap)
        });

        if (apiOperation.request) {
            const inputPayload = (apiOperation.request.payloads || []).find((p) => p.schema != null)
            if (inputPayload != null) {
                const inputPayloadParam = new meta.OperationParameter();
                inputPayloadParam.uuid = Md5.hashStr(`${apiOperation.id}inputPayloadParam`).toString()
                const inputPayloadSchema = this.parseParamShape(inputPayload.schema, acc, entityMap)
                if (inputPayloadSchema instanceof Scalar) {
                    inputPayloadParam.scalarRange = inputPayloadSchema
                } else {
                    // if this is a reference an adapted type will be returned
                    // we extract it because params only accept links
                    if (inputPayloadSchema.adapts != null) {
                        inputPayloadParam.objectRange = inputPayloadSchema.adapts
                    } else {
                        acc.push(inputPayloadSchema)
                        inputPayloadParam.objectRange = inputPayloadSchema
                    }

                }
                operation.inputs = (operation.inputs || []).concat([inputPayloadParam])
            }
        }

        const maybeResponse = apiOperation.responses.filter((resp) => {
            const statusCode = (resp.statusCode.option || "")
            return statusCode === "default" || statusCode.startsWith("2")
        }).find(resp => resp.payloads.find((p) => p.schema != null))

        if (maybeResponse != null) {
            const outputParam = new meta.OperationParameter();
            outputParam.uuid = Md5.hashStr(`${apiOperation.id}output`).toString()

            const payload = maybeResponse.payloads.find((p) => p.schema != null)!
            const payloadSchema = this.parseParamShape(payload.schema, acc, entityMap)
            if (payloadSchema instanceof Scalar) {
                outputParam.scalarRange = payloadSchema
            } else {
                outputParam.objectRange = payloadSchema
            }

            operation.output = outputParam
        }
        return operation;
    }

    private parseParameter(p: amf.model.domain.Parameter, acc: meta.Entity[], entityMap: {[id: string]: string}): meta.OperationParameter {
        const param = new meta.OperationParameter();
        param.uuid = Md5.hashStr(p.id).toString();
        param.name = p.name.value();
        if (p.description.option) {
            param.description = p.description.value()
        }
        param.required = p.required.option || false;

        if (p.schema != null) {
            const payloadSchema = this.parseParamShape(p.schema, acc, entityMap)
            if (payloadSchema instanceof Scalar) {
                param.scalarRange = payloadSchema
            } else {
                param.objectRange = payloadSchema
            }
        } else {
            // default argument, is a string
            param.scalarRange = new meta.StringScalar();
        }

        return param;
    }

    private parseParamShape(schema: amf.model.domain.Shape, acc: meta.Entity[], entityMap: {[id: string]: string}): meta.Scalar | meta.Entity {
        if (this.isScalarShape(schema)) {
            const fakeProp = new amf.model.domain.PropertyShape().withRange(schema).withId(schema.id + "_fake_prop");
            const attr = this.parseAttribute(fakeProp);
            return attr.range;
        } else {
            const parsed = this.adaptOrCreate(schema, this.genName("param"), acc, entityMap)
            if (parsed != null) {
                return parsed
            } else {
                throw new Error("Parsing of object entity parameter failed");
            }
        }
    }

    /**
     * Parses all the shapes in an AMF BaseUnit as modeling entities
     * @param module
     * @param baseUnit
     */
    private parseShapes(baseUnit: amf.model.document.BaseUnit): meta.Entity[] {
        let entities: meta.Entity[] = [];
        if (baseUnit instanceof amf.model.document.Module || baseUnit instanceof amf.model.document.Document) {
            const declarations = <amf.model.document.DeclaresModel>baseUnit;
            (declarations.declares || []).forEach((domainElement) => this.parseShape(domainElement, entities, true))
        }

        if (baseUnit instanceof amf.model.domain.DataType) {
            const encoded = <amf.model.document.EncodesModel>baseUnit;
            this.parseShape(encoded.encodes, entities, true)
        }
        return entities
    }

    private parseShape(domainElement: amf.model.domain.DomainElement, entities: meta.Entity[], topLevel: boolean = false): meta.Entity|null {
        const uuid = Md5.hashStr(domainElement.id).toString();
        const alreadyParsed = entities.find((e) => e.uuid === uuid);

        if (alreadyParsed != null) {
            return alreadyParsed;
        } else {
            if (this.isLink(domainElement)) {
                const linkTarget = (<amf.model.domain.AnyShape>domainElement).linkTarget!.id;
                const linkName = (<amf.model.domain.AnyShape>domainElement).linkLabel!.value()
                const link = new meta.Entity(linkName);
                link.uuid = Md5.hashStr(linkTarget).toString();
                // @ts-ignore
                link['isLink'] = true;
                return link;
            } else {
                let parsed: meta.Entity|null = null;
                if (domainElement instanceof amf.model.domain.NodeShape) {
                    parsed = this.parseNodeShape(<amf.model.domain.NodeShape>domainElement, entities);
                } else if (domainElement instanceof amf.model.domain.UnionShape) {
                    parsed = this.parseUnionShape(<amf.model.domain.UnionShape>domainElement, entities);
                } else if (domainElement instanceof amf.model.domain.AnyShape) {
                    // parsed = this.parseAnyShape(<amf.model.domain.AnyShape>domainElement, entities);
                }
                if (parsed != null) {
                    entities.push(this.uniqueName(parsed, entities))
                    if (topLevel) {
                        // @ts-ignore
                        parsed['top_level'] = true
                    }
                }
                return parsed;
            }
        }
    }

    private parseUnionShape(unionShape: amf.model.domain.UnionShape, entities: meta.Entity[]) {
        const name = this.getShapeName(unionShape)
        const entity = new meta.Entity(name)
        const unionMembers = unionShape.anyOf
            .map((shape) => this.parseShape(shape, entities))
            .filter((shape) => shape != null)
        entity.disjoint = <meta.Entity[]>unionMembers;
        return entity;
    }

    /**
     * Parses a generic AnyShape
     * @param domainElement1
     * @param entities
     */
    private parseAnyShape(anyShape: amf.model.domain.AnyShape, entities: meta.Entity[]) {
        const name = this.getShapeName(anyShape)
        const entity = new meta.Entity(name)
        entity.uuid = Md5.hashStr(anyShape.id).toString();
        entity.displayName = anyShape.displayName.option
        entity.description = anyShape.description.option
        return entity;
    }

    /**
     * Parses an individual object shape and generates a modeling entity out of it
     * @param nodeShape
     */
    private parseNodeShape(nodeShape: amf.model.domain.NodeShape, entities: meta.Entity[]): meta.Entity|null {
        const name = this.getShapeName(nodeShape)
        const entity = new meta.Entity(name)
        entity.uuid = Md5.hashStr(nodeShape.id).toString();
        entity.displayName = nodeShape.displayName.option
        entity.description = nodeShape.description.option

        // Process extensions using the base shapes in the model
        if (nodeShape.inherits.length !== 0) {
            const extensions = nodeShape.inherits.map((baseShape) => {
                return this.parseShape(baseShape, entities);
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
            if (property.range instanceof amf.model.domain.UnionShape && this.isNilUnion(property.range)) {
                const notNil = this.extractFromNilUnion(property.range);
                property.withRange(notNil).withMinCount(0);
            }
            if (this.isScalarShape(property.range)) {
                scalarProperties.push(property)
            } else if (this.isObjectShape(property.range)) {
                objectProperties.push(property)
            } else if (property.range instanceof amf.model.domain.ArrayShape) {
                let arrayShape = <amf.model.domain.ArrayShape>property.range;
                if (this.isScalarShape(arrayShape.items)) {
                    scalarProperties.push(property)
                } else if (this.isObjectShape(arrayShape.items)) {
                    objectProperties.push(property)
                } else {
                    // @todo
                    // throw new Error(`Unsupported property range array items shape ${arrayShape.items}`);
                    console.log(`Not supported type ${property.id} -> ${arrayShape.items}`)
                }
            } else {
                // @todo
                // throw new Error(`Unsupported property range shape ${property.range}`);
                console.log(`Not supported type ${property.id} -> ${property.range}`)
            }
        });

        entity.attributes = scalarProperties.map((property) => {
            return this.parseAttribute(property);
        });

        entity.associations = objectProperties.map((property) => {
            return this.parseAssociation(property, entities);
        });

        return entity;
    }

    private isScalarShape(shape: amf.model.domain.Shape): boolean {
        return shape instanceof amf.model.domain.ScalarShape;
    }

    /**
     * Checks that a shape can be transformed into an modeling Entity
     * @param shape
     */
    private isObjectShape(shape: amf.model.domain.Shape): boolean {
        if (shape instanceof amf.model.domain.ScalarShape) {
            return false;
        }
        if (shape instanceof amf.model.domain.NodeShape) {
            return true;
        }
        if (shape instanceof amf.model.domain.UnionShape) {
            let allObject = true;
            (<amf.model.domain.UnionShape>shape).anyOf.forEach((member) => {
                allObject = allObject && this.isObjectShape(member)
            })
            if (!allObject) {
                throw new Error(`Unsupported scalar union ${shape.id}`) // @todo support this maybe with a custom scalar?
            }
            return allObject;
        }
        /*
        if (shape instanceof amf.model.domain.AnyShape) {
            return true;
        }
         */
        return false;
    }

    private isNilUnion(shape: amf.model.domain.UnionShape): boolean {
        if ((shape.anyOf||[]).length === 2) {
            const notNil = shape.anyOf.filter((s) => {
                return s instanceof amf.model.domain.NilShape
            });

            return notNil.length === 1;
        } else {
            return false;
        }
    }

    private extractFromNilUnion(shape: amf.model.domain.UnionShape): amf.model.domain.Shape {
        const notNil = shape.anyOf.filter((s) => {
            return s instanceof amf.model.domain.NilShape
        });

        return notNil[0]!
    }

    /**
     * Checks that a shape can be transformed into a modeling Scalar value
     * @param shape
     */
    private getShapeName(shape: amf.model.domain.Shape, hint: string = "Entity"): string {
        const name = shape.displayName.option || shape.name.option ;
        if (name != null && name !== "type" && name !== "schema") {
            return name;
        } else {
            return this.genName(hint);
        }
    }


    private genName(root: string) {
        this.idGenerator++;
        return `${root}${this.idGenerator}`;
    }

    private parseAttribute(property: amf.model.domain.PropertyShape): meta.Attribute {
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
        const name = this.getShapeName(property, "attribute")
        const attribute = new meta.Attribute(name, scalarRange)
        attribute.uuid = Md5.hashStr(property.id).toString();
        attribute.description = property.description.option;
        attribute.required = (property.minCount.option || 0) !== 0;
        attribute.allowMultiple = property.range instanceof amf.model.domain.ArrayShape;

        // @todo parse additional attributes for a property shape and add bindings
        return attribute;
    }

    private parseAssociation(property: amf.model.domain.PropertyShape, entities: meta.Entity[]): meta.Association {
        // lets get the final shape
        let shape = property.range;
        if (shape instanceof amf.model.domain.ArrayShape) {
            shape = (<amf.model.domain.ArrayShape>shape).items
        }

        let range = this.parseShape(shape, entities)

        if (range != null) {
            // now we can create the association wrapper
            const name = this.getShapeName(property, "association")
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

    private isLink(domainElement: amf.model.domain.DomainElement) {
        if (domainElement instanceof amf.model.domain.AnyShape) {
            const anyShape = <amf.model.domain.AnyShape>domainElement;
            return anyShape.isLink;
        } else {
            return false;
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

    private uniqueName(parsed: meta.Entity, entities: meta.Entity[]) {
        const names: {[name: string]: boolean} = {}
        entities.forEach((e) => names[e.name] = true)
        let c = 0;
        let name = parsed.name
        while (names[name]) {
            c++
            name = `${parsed.name}${c}`
        }
        parsed.name = name
        if (parsed.displayName != null && c > 0) {
            parsed.displayName = `${parsed.displayName}${c}`
        }
        names[parsed.name] = true;

        return parsed;
    }

}