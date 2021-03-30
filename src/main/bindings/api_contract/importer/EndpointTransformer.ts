import {ShapeTransformer, TransformedShape} from "./ShapeTransformer";
import {IDGenerator} from "./IDGenerator";
import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Md5} from "ts-md5/dist/md5";
import {AMFModelQueries as $amfModel} from "./AMFModelQueries";
import {VOCAB} from "../constants";
import {Entity, Scalar} from "@api-modeling/api-modeling-metadata";
import {BindingsBuilder} from "./BindingsBuilder";

export class EndpointTransformer extends ShapeTransformer {
    private entityMap: {[id: string]: string} = {}
    private resources: meta.Resource[] = [];
    private bindings: BindingsBuilder = new BindingsBuilder();

    constructor(moduleUri: string, baseUnit: amf.model.document.BaseUnit, idGenerator: IDGenerator, entityMap: {[id: string]: string} = {}) {
        super(moduleUri, baseUnit, idGenerator);
        this.entityMap = entityMap;
    }

    public getBindings() {
        return this.bindings.bindings;
    }

    public transformBaseUnitApiModel(): meta.ApiModel {
        const name = this.baseUnit.location.split("/").reverse()[0];
        //@ts-ignore
        const webapi = (<amf.model.domain.WebApi>this.baseUnit).encodes;
        const entrypoint = new meta.Resource();
        entrypoint.uuid = Md5.hashStr(webapi.id + "_entrypoint").toString()

        entrypoint.name = webapi.name.value();
        if (webapi.description.option) {
            entrypoint.description = webapi.description.value();
        }

        this.transformResourceLinks(entrypoint, "", [], webapi.endPoints)


        const apiModel = new meta.ApiModel();
        apiModel.uuid = Md5.hashStr(webapi.id).toString();
        apiModel.name = name;
        apiModel.entryPoint = entrypoint;
        apiModel.resources = this.resources;
        apiModel.entities = this.entities;


        this.bindings.addServerBindings(webapi, apiModel);

        return apiModel;

    }

    protected transformResourceLinks(resource: meta.Resource, path: string, pathParams: string[], endpoints: amf.model.domain.EndPoint[]): meta.Resource {
        if (endpoints.length > 0) {
            const operations: meta.Operation[] = [];

            this.foldEndPoints(endpoints).forEach((group) => {

                const linkedEndpoint = group.shift()!;
                const getOperation = $amfModel.findOperationByMethod("get", linkedEndpoint);
                const newPathParams: amf.model.domain.Parameter[] = linkedEndpoint.parameters.filter((p: amf.model.domain.Parameter) => {
                    return !pathParams.includes(p.name.value())
                });


                // linked resource
                if (getOperation != null) {
                    const nestedResource = this.transformResource(linkedEndpoint, path, pathParams, group)
                    const linkOperation = this.transformGetOperation(newPathParams, getOperation, (resource instanceof meta.CollectionResource))
                    linkOperation.name = `Find ${nestedResource.name}`

                    // setup the output parameter to the schema of the linked resource
                    // const outputParameter = new meta.OperationParameter();
                    // outputParameter.uuid = Md5.hashStr(getOperation.id + "output").toString();
                    // outputParameter.name = nestedResource.name;
                    // outputParameter.objectRange = nestedResource.schema;
                    // linkOperation.output = outputParameter;

                    if (resource instanceof meta.CollectionResource) {
                        // connect both resources through membership
                        (<meta.CollectionResource>resource).member = nestedResource;
                    } else {
                        // connect both resources through a transition
                        const transition = new meta.ResourceTransition();
                        transition.uuid = Md5.hashStr(getOperation.id + "transition").toString();
                        transition.target = nestedResource
                        linkOperation.transition = transition;
                    }

                    // add bindings
                    this.bindings.addOperationBindings(linkedEndpoint, getOperation, linkOperation)

                    operations.push(linkOperation)

                } else  { // nested operation
                    linkedEndpoint.operations.forEach((op)=> {
                        const controlOperation = this.transformMutableOperation(newPathParams, op);
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

                        // add bindings
                        this.bindings.addOperationBindings(linkedEndpoint, op, controlOperation)

                        operations.push(controlOperation)
                    }) ;

                    if (group.length > 0) {
                        this.transformResourceLinks(resource, path,  pathParams, group)
                    }
                }
            });

            const oldOperations = resource.operations || [];
            resource.operations = oldOperations.concat(operations);
        }

        return resource;
    }

    private transformResource(endpoint: amf.model.domain.EndPoint, parent: string, pathParams: string[], group: amf.model.domain.EndPoint[]): meta.Resource {

        let resource = new meta.Resource();

        const getOperation = $amfModel.findOperationByMethod("get", endpoint);
        const resp = $amfModel.findResponsesByStatus(["200", "2"],getOperation);
        let effectiveShape = $amfModel.findResponseSchema(resp);

        if (effectiveShape instanceof amf.model.domain.ArrayShape) {
            resource = new meta.CollectionResource(); // @todo: deal with collection here
        } else if (effectiveShape) {
            const entity = this.adaptOrCreate(effectiveShape, endpoint.id + "get")
            if (entity) {
                resource.schema = entity
            }
        }
        this.resources.push(resource)

        resource.operations = [];
        const otherOperations = endpoint.operations.filter((op) => op.method.value() !== "get");
        if (otherOperations.length > 0) {
            otherOperations.forEach((op) => {
                const controlOperation = this.transformMutableOperation([], op);
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

                this.bindings.addOperationBindings(endpoint, op, controlOperation)

                resource!.operations!.push(controlOperation)
            });
        }

        this.transformResourceLinks(resource, endpoint.path.value(), pathParams, group)

        resource.name = `Resource ${endpoint.path}`
        if (endpoint.description.option) {
            resource.description = endpoint.description.value()
        }
        return resource
    }



    private transformGetOperation(newPathParams: amf.model.domain.Parameter[], apiOperation: amf.model.domain.Operation, isCollection: boolean): meta.Operation {
        const operation = new meta.CustomOperation();
        operation.uuid = Md5.hashStr(apiOperation.id).toString();
        operation.isMutation = false;

        let toParseParams = newPathParams;
        if (apiOperation.request != null && apiOperation.request.queryParameters != null) {
            toParseParams = toParseParams.concat(apiOperation.request.queryParameters)
        }
        operation.inputs = toParseParams.map((p) => {
            const parsedParam = this.transformParameter(p);
            this.bindings.addParameterBinding(parsedParam, p.binding.value());
            return parsedParam
        });

        this.transformOperationOutput(apiOperation, operation);

        return operation;
    }

    private transformMutableOperation(newPathParams: amf.model.domain.Parameter[], apiOperation: amf.model.domain.Operation): meta.Operation {
        const operation = new meta.CustomOperation();
        operation.uuid = Md5.hashStr(apiOperation.id).toString();
        operation.isMutation = true;

        // bindings
        operation.inputs = newPathParams.map((param) => {
            const parsedParam = this.transformParameter(param);
            this.bindings.addParameterBinding(parsedParam, "path");
            return parsedParam
        });


        if (apiOperation.request != null && apiOperation.request.queryParameters != null) {
            apiOperation.request.queryParameters.forEach((param) => {
                const parsedParam = this.transformParameter(param)
                this.bindings.addParameterBinding(parsedParam, "query");
                operation.inputs?.push(parsedParam);
            });
        }

        if (apiOperation.request) {
            const inputPayload = (apiOperation.request.payloads || []).find((p) => p.schema != null)
            if (inputPayload != null) {
                const inputPayloadParam = new meta.OperationParameter();
                inputPayloadParam.uuid = Md5.hashStr(`${apiOperation.id}inputPayloadParam`).toString();
                const inputPayloadSchema = this.transformParamShape(inputPayload.schema, true);
                if (inputPayloadSchema.schema instanceof Scalar) {
                    inputPayloadParam.scalarRange = inputPayloadSchema.schema;
                } else {
                    // if this is a reference an adapted type will be returned
                    // we extract it because params only accept links
                    if (inputPayloadSchema.schema.adapts != null) {
                        this.removeTransformedShape(inputPayloadSchema.schema.uuid)
                        inputPayloadParam.objectRange = inputPayloadSchema.schema.adapts;
                    } else {
                        if (this.entities.find((e) => e.uuid == (<Entity>inputPayloadSchema.schema).uuid) ==  null) {
                            this.entities.push(inputPayloadSchema.schema);
                        }
                        inputPayloadParam.objectRange = inputPayloadSchema.schema;
                    }
                }
                inputPayloadParam.allowMultiple = inputPayloadSchema.allowMultiple;
                this.bindings.addParameterBinding(inputPayloadParam, "body");
                operation.inputs = (operation.inputs || []).concat([inputPayloadParam]);
            }
        }
        this.transformOperationOutput(apiOperation, operation)

        return operation;
    }

    private transformOperationOutput(apiOperation: amf.model.domain.Operation, operation: meta.Operation) {
        const maybeResponse = apiOperation.responses.filter((resp) => {
            const statusCode = (resp.statusCode.option || "")
            return statusCode === "default" || statusCode.startsWith("2")
        }).find(resp => resp.payloads.find((p) => p.schema != null));

        if (maybeResponse != null) {
            const outputParam = new meta.OperationParameter();
            outputParam.uuid = Md5.hashStr(`${apiOperation.id}output`).toString();

            const payload = maybeResponse.payloads.find((p) => p.schema != null)!;

            this.bindings.addResponseBindings(maybeResponse, payload, operation);

            let payloadSchema = this.transformParamShape(payload.schema, true);
            if (payloadSchema.schema instanceof Scalar) {
                outputParam.scalarRange = payloadSchema.schema;
            } else {
                outputParam.objectRange = payloadSchema.schema;
            }
            outputParam.allowMultiple = payloadSchema.allowMultiple;

            operation.output = outputParam
        }
    }

    private transformParameter(p: amf.model.domain.Parameter): meta.OperationParameter {
        const param = new meta.OperationParameter();
        param.uuid = Md5.hashStr(p.id).toString();
        param.name = p.name.value();
        if (p.description.option) {
            param.description = p.description.value()
        }
        param.required = p.required.option || false;

        if (p.schema != null) {
            const payloadSchema = this.transformParamShape(p.schema, false)
            if (payloadSchema.schema instanceof Scalar) {
                param.scalarRange = payloadSchema.schema
            } else {
                param.objectRange = payloadSchema.schema
            }
            param.allowMultiple = payloadSchema.allowMultiple;
        } else {
            // default argument, is a string
            param.scalarRange = new meta.StringScalar();
        }

        return param;
    }

    private transformParamShape(schema: amf.model.domain.Shape, isBody: boolean): TransformedShape {
        const isArray = (schema instanceof amf.model.domain.ArrayShape);

        if (isArray) {
            schema = (<amf.model.domain.ArrayShape>schema).items
        }
        if ($amfModel.isScalarShape(schema)) {
            const fakeProp = new amf.model.domain.PropertyShape().withRange(schema).withId(schema.id + "_fake_prop");
            const attr = this.transformScalarPropertyShape(fakeProp);
            return { allowMultiple: isArray, schema: attr.range};
        } else {
            const parsed = this.adaptOrCreate(schema, this.idGenerator.genName("param"))
            if (parsed != null) {
                return { allowMultiple: isArray, schema: parsed}
            } else {
                if (isBody) {
                    const fakeBody = new meta.Entity(this.idGenerator.genName(schema.name.option || "Body"))
                    return {allowMultiple: isArray, schema: fakeBody }
                } else {
                    const fakeProp = new amf.model.domain.PropertyShape().withRange(new amf.model.domain.ScalarShape().withDataType(VOCAB.XSD_STRING)).withId(schema.id + "_fake_prop");
                    const attr = this.transformScalarPropertyShape(fakeProp);
                    return {allowMultiple: isArray,schema:  attr.range }
                }
            }
        }
    }


    /**
     * Builds the next level of resources in the tree of paths provided by the API spec
     * @param endpoints
     * @private
     */
    private foldEndPoints(endpoints: amf.model.domain.EndPoint[]) {
        const groups: amf.model.domain.EndPoint[][] = [];
        let currentGroup: amf.model.domain.EndPoint[] = [];

        const sortedEndpoints= endpoints
            .filter((ep: amf.model.domain.EndPoint) => $amfModel.isResource(ep))
            .sort((a: amf.model.domain.EndPoint, b: amf.model.domain.EndPoint) => {
                if (a.path.value() == b.path.value()) {
                    return 0
                } else if (a.path.value() < b.path.value()) {
                    return -1;
                } else {
                    return 1;
                }
            });

        // this.printResourceTree(endpoints)

        sortedEndpoints.forEach((ep) => {
            let current = currentGroup[0]
            const nestedPath = current == null || ep.path.value().indexOf(current.path.value() + "/") == 0;
            if ( nestedPath ) { // nested resource
                currentGroup.push(ep)
            } else { // nested operation over the top level resource
                groups.push(currentGroup);
                currentGroup = [ep];
            }
        });

        if (currentGroup.length > 0) {
            groups.push(currentGroup)
        }

        return groups
    }

    private adaptOrCreate(schema: amf.model.domain.Shape, adaptedIdSuffix: string): meta.Entity|null {
        const schemaId = Md5.hashStr(schema.id).toString();
        const adaptedName = this.entityMap[schemaId];
        if (adaptedName) {
            const entity = new meta.Entity(adaptedName);
            entity.uuid = Md5.hashStr(schema.id + adaptedIdSuffix).toString();
            const link = new meta.Entity(adaptedName);
            link.uuid = schemaId;
            entity.adapts = link;
            return entity;
        } else {
            const parsed = this.transformShape(schema)
            // @ts-ignore
            if (parsed != null && parsed['isLink']) {
                const entity = new meta.Entity(parsed.name);
                entity.uuid = Md5.hashStr(schema.id + adaptedIdSuffix).toString();
                entity.adapts = parsed;
                entity.name = this.idGenerator.genName("AdaptedEntity." + entity.name)
                this.entities.push(entity)
                return entity;
            } else {
                return parsed;
            }
        }
    }

    /*
    // Auxiliary method to print resource tree
    private printResourceTree(endpoints: amf.model.domain.EndPoint[], level: number = 0) {
        if (endpoints.length > 0) {
            const groups = this.foldEndPoints(endpoints);
            groups.forEach((resources) => {
                const parent = resources.shift()!;
                let acc = ""
                for (let i=0; i<level; i++) {
                    acc = acc + " ";
                }
                console.log(acc + parent.path.value());
                this.printResourceTree(resources, level + 2);
            })
        }
    }
    */

}