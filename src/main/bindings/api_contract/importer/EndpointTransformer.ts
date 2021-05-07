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

            const groups = this.foldEndPoints(endpoints)
            groups.forEach((group) => {

                const linkedEndpoint = group.shift()!;
                const getOperation = $amfModel.findOperationByMethod("get", linkedEndpoint);
                const newPathParams: amf.model.domain.Parameter[] = linkedEndpoint.parameters.filter((p: amf.model.domain.Parameter) => {
                    return !pathParams.includes(p.name.value())
                });
                const varRegex = /\{[\w-\ ]+\}/g
                const matches = linkedEndpoint.path.value().match(varRegex) || [];
                matches.forEach((match) => {
                    const variable = match.replace("{", "").replace("}","");
                    const inParams = (linkedEndpoint.parameters.find((param: amf.model.domain.Parameter) => param.name.value() === variable) != null)
                    const inNewParams = (newPathParams.find((param: amf.model.domain.Parameter) => param.name.value() == variable) != null)
                    if (!inParams && !inNewParams) {
                        const newPathParam = new amf.model.domain.Parameter();
                        newPathParam.withName(variable).withRequired(true).withScalarSchema(variable).withDataType(VOCAB.XSD_STRING);
                        newPathParam.withId(linkedEndpoint.id + "_uriParam_" + variable)
                        newPathParams.push(newPathParam);
                    }
                });


                // linked resource
                if (getOperation != null) {
                    const isAsyncChannel = $amfModel.isAsyncChannel(linkedEndpoint)
                    const nestedResource = this.transformEndpoint(linkedEndpoint, path, pathParams.concat(newPathParams.map((p) => p.name.value())), group)
                    const linkOperation = this.transformGetOperation(newPathParams, getOperation, isAsyncChannel)
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
                        transition.target = nestedResource.id()
                        linkOperation.transition = transition;
                    }

                    // add bindings
                    this.bindings.addOperationBindings(linkedEndpoint, getOperation, linkOperation)

                    operations.push(linkOperation)

                } else  { // nested operation
                    const asyncOperations = $amfModel.findAsyncOperations(linkedEndpoint);
                    const mutableOperations = $amfModel.findMutableOperations(linkedEndpoint);
                    this.transformAsyncOperations(asyncOperations, resource, path);
                    mutableOperations.forEach((op)=> {
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
                        } else {
                            action = method
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

    private transformEndpoint(endpoint: amf.model.domain.EndPoint, parent: string, pathParams: string[], group: amf.model.domain.EndPoint[]): meta.Resource {
        let resource = this.buildResourceForSchema(endpoint);
        this.buildResourceOperations(endpoint, resource);
        this.transformResourceLinks(resource, endpoint.path.value(), pathParams, group)
        return resource
    }

    private buildResourceOperations(endpoint: amf.model.domain.EndPoint, resource: meta.Resource) {
        const asyncOperations = $amfModel.findAsyncOperations(endpoint);
        const mutableOperations = $amfModel.findMutableOperations(endpoint);
        this.transformAsyncOperations(asyncOperations, resource, endpoint.path.value());
        mutableOperations.forEach((op) => {
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
                action = `${action} ${op.method.value()}`;
            }
            controlOperation.name = action

            this.bindings.addOperationBindings(endpoint, op, controlOperation)

            resource!.operations!.push(controlOperation)
        });
    }

    /**
     * Sets the schema for the resource also transforms it into a Collection if the schema is an array.
     * If the resource is raw Async channel, then just generate a wrapping resource.
     * @param endpoint
     * @private
     */
    private buildResourceForSchema(endpoint: amf.model.domain.EndPoint) {
        let resource = new meta.Resource();
        resource.operations = [];
        resource.name = `Resource ${endpoint.path}`
        if (endpoint.description.option) {
            resource.description = endpoint.description.value()
        }
        if (!$amfModel.isAsyncChannel(endpoint)) {
            const getOperation = $amfModel.findOperationByMethod("get", endpoint);
            const resp = $amfModel.findResponsesByStatus(["200", "2"],getOperation);
            let effectiveShape = $amfModel.findResponseSchema(resp);

            if (effectiveShape instanceof amf.model.domain.ArrayShape) {
                let collection = new meta.CollectionResource(); // @todo: deal with collection here
                collection.name = resource.name;
                collection.operations = resource.operations;
                collection.description = resource.description;
                resource = collection;
            } else if (effectiveShape) {
                const entity = this.adaptOrCreate(effectiveShape, endpoint.id + "get")
                if (entity) {
                    resource.schema = entity
                }
            }
        }
        this.resources.push(resource);
        return resource;
    }

    private transformAsyncOperations(asyncOperations: amf.model.domain.Operation[], resource: meta.Resource, path: string) {
        resource.events = resource.events || [];
        const publish = asyncOperations.filter((op) => op.method.value() == "publish");
        const subscribe = asyncOperations.filter((op) => op.method.value() == "subscribe");

        // accumulator to discover events
        const eventMap: {[id: string]: {publish: meta.OperationParameter, subscribe: meta.OperationParameter}} = {};
        const events: {[id:string]: meta.Entity} = {};
        const scalarEvents: {[id: string]: meta.OperationParameter} = {};

        publish.concat(subscribe).forEach((op) => {
            const operationType = op.method.value();
            const schema = $amfModel.findAsyncOperationSchema(op);
            if (schema) {
                const params = this.shapeToParameterSet(op.id, schema)
                params.forEach((param) => {
                    const eventId = param.uuid
                    if (param.objectRange) {
                        const eventOps = eventMap[eventId]   || {};
                        eventMap[eventId] = eventOps;

                        //@ts-ignore
                        if (eventOps[operationType]) {
                            //@ts-ignore
                            eventOps[operationType].allowMultiple = eventOps[operationType].allowMultiple || param.allowMultiple;
                        } else {
                            //@ts-ignore
                            eventOps[operationType] = param;
                        }
                        events[eventId] = param.objectRange
                    } else {
                        const eventOps = eventMap[eventId]   || {};
                        eventMap[eventId] = eventOps;

                        //@ts-ignore
                        if (eventOps[operationType]) {
                            //@ts-ignore
                            eventOps[operationType].allowMultiple = eventOps[operationType].allowMultiple || param.allowMultiple;
                        } else {
                            //@ts-ignore
                            eventOps[operationType] = param;
                        }
                        scalarEvents[eventId] = param; // again param is a wrapper for the scalar here
                    }
                });
            }
        });

        Object.keys(events).concat(Object.keys(scalarEvents)).forEach((eventId) => {
            const shape = (events[eventId] || scalarEvents[eventId])!;
            const publish = eventMap[eventId]?.publish;
            const subscribe = eventMap[eventId]?.subscribe;

            const event = new meta.CustomEvent()
            event.uuid = Md5.hashStr(eventId + "_event").toString();

            if (shape.name && shape.name != "schema") {
                event.name = shape.name;
                if (shape.displayName) {
                    event.displayName = shape.displayName;
                }
            } else {
                event.name = "Event" + event.uuid.substr(shape.id.length - 5);
                event.displayName = "Event " + event.uuid.substr(shape.id.length - 5);
            }

            if (publish != null) {
                publish.uuid = Md5.hashStr(path + publish?.uuid +"_publish_event").toString();
                event.publish = publish;
            }

            if (subscribe != null) {
                subscribe.uuid = Md5.hashStr(path + publish?.uuid +"_subscribe_event").toString();
                event.subscribe = subscribe
            }

            resource.events!.push(event);events
        });
    }

    private transformGetOperation(newPathParams: amf.model.domain.Parameter[], apiOperation: amf.model.domain.Operation, isAsyncChannel: boolean): meta.Operation {
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

        if (!isAsyncChannel) {
            this.transformOperationOutput(apiOperation, operation);
        }

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

        if (isArray && (<amf.model.domain.ArrayShape>schema).items != null) {
            schema = (<amf.model.domain.ArrayShape>schema).items
        }
        if ($amfModel.isScalarShape(schema)) {
            const fakeProp = new amf.model.domain.PropertyShape().withRange(schema).withId(schema.id + "_fake_prop");
            const attr = this.transformScalarPropertyShape(fakeProp);
            return { allowMultiple: isArray, schema: attr.range!};
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
                    return {allowMultiple: isArray,schema:  attr.range! }
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

        //this.printResourceTree(endpoints)

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