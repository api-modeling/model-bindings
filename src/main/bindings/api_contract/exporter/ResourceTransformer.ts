import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Traversal} from "./APIModelTransformer";
import {VOCAB} from "../constants";
import {BindingScalarValue} from "@api-modeling/api-modeling-metadata";
import {ExporterBaseUtils} from "../../utils/ExporterBaseUtils";
import {ExportContext} from "./ExportContext";
import {DataEntityTransformer} from "./DataEntityTransformer";

export class ResourceTransformer extends ExporterBaseUtils {
    private resource: meta.Resource;
    private traversal: Traversal;
    private parentPath: string;
    private context: ExportContext;
    // accumulators
    private endpointsAcc: {[path: string]: amf.model.domain.Operation[]} = {};
    private endpointsParamsAcc: {[path: string]: amf.model.domain.Parameter[]} = {};
    private endpointModelingOpAcc: {[path: string]: meta.Operation[]} = {};
    private opDisambg: {[key: string]: boolean} = {};

    constructor(traversal: Traversal, context: ExportContext) {
        super();
        this.resource = traversal.current;
        this.traversal = traversal;
        this.parentPath = traversal.path;
        this.context = context;
    }

    public transform() {
        (this.resource.operations||[]).forEach((op) => {
            this.transformOperation(op);
        });

        const operationsAcc: {[id: string]: amf.model.domain.Operation[]} = {};

        const endpoints =  Object.keys(this.endpointsAcc).map((path) => {
            const operations = this.endpointsAcc[path];
            const endpoint = new amf.model.domain.EndPoint();
            endpoint
                .withId(this.traversal.current.id() + path.replace("/", "_"))
                .withPath(path)
            operationsAcc[endpoint.id] = operations

            const pathParams = this.endpointsParamsAcc[path]

            if (pathParams && pathParams.length != 0) {
                endpoint.withParameters(pathParams);
            }
            return endpoint;
        });

        const asyncOperations = this.transformEvents(this.resource, this.resource.events||[])
        const sortedEndpoints = endpoints.sort((epa,epb) => {
            const pa = epa.path.value();
            const pb = epa.path.value();
            const la = pa.length;
            const lb = pb.length;
            if (la < lb) {
                return -1;
            } else if (la > lb) {
                return 1;
            } else if (pa < pb){
                return -1;
            } else if (pa > pb) {
                return 1;
            } else {
                return 0
            }
        });
        const getEndpoint = endpoints.find((ep) => {
            const operations = operationsAcc[ep.id];
            return operations.find((op)=> op.method.value() == "get") != null
        });

        const endPoint = getEndpoint || sortedEndpoints[0];
        // MDF Original order pushes the asynch ops to the suboperations, but in th model, async
        // is attached to the resource.
        /*
        if (endPoint != null) {
            const oldOperations = operationsAcc[endPoint.id];
            if (asyncOperations.length > 0) {
                this.context.hasAsyncOperations = true; // we signal support async
            }
            // operationsAcc[endPoint.id] = oldOperations.concat(asyncOperations)
        } 
        */
        if (asyncOperations.length > 0) {
            this.context.hasAsyncOperations = true;
            const asyncMap: {[id:string]:amf.model.domain.Operation[]} = {}
            asyncOperations.forEach((asyncOperation) => {
                //@ts-ignore
                const event = <meta.Event> asyncOperation.__EVENT;
                const ops = asyncMap[event.name!] || []
                ops.push(asyncOperation)
                asyncMap[event.name!] = ops;
            });
            Object.keys(asyncMap).forEach((eventName) => {
                const operations = asyncMap[eventName];
                const asyncOperation = operations[0]!;
                const asyncChannel = new amf.model.domain.EndPoint().withId(asyncOperation.id + "_channel");
                asyncChannel.withPath(this.traversal.path /* + "/" + encodeURIComponent(eventName) */)
                asyncChannel.withOperations(operations);
                endpoints.push(asyncChannel);
            });
        }

        endpoints.forEach((ep) => {
            const operations = operationsAcc[ep.id];
            if (operations) {
                ep.withOperations(operations);
            }
        });

        return endpoints;
    }

    public apiOperationsForTransformed(endpoint: amf.model.domain.EndPoint) {
        return this.endpointModelingOpAcc[endpoint.path.value()] || [];
    }

    private transformEntity(entity: meta.Entity): amf.model.domain.AnyShape {
        const declaredEntity = this.context.entityById(entity.id());
        if (declaredEntity && declaredEntity.adapts != null) {
            return this.context.generateLink(null, declaredEntity.adapts.id(), this.traversal.baseUnit.id)
        } else {
            if (declaredEntity != null) {
                return this.context.generateLink(null, declaredEntity.id(), this.traversal.baseUnit.id);
            } else {
                if (this.context.indexedEntity(entity.id())) {
                    return this.context.generateLink(null, entity.id(), this.traversal.baseUnit.id)
                } else {
                    return new DataEntityTransformer(entity, this.context).transform();
                }
            }
        }
    }

    private transformOperation(op: meta.Operation) {
        let operation = new amf.model.domain.Operation();
        operation.withId(op.id());
        this.generateElementName(op.name, op.description, operation)
        // @todo: create annotations/extensions here for the standard operations
        // const customDomainProperties: amf.model.domain.CustomDomainProperty[] = [];
        this.generateOperationMethod(op, operation);
        const pathParams = this.generateOperationRequest(op, operation);
        this.generateOperationResponse(op, operation);
        let path = this.generateOperationPath(operation.method.value(), op, pathParams);
        this.registerOperation(path, op, operation, pathParams)
    }

    private registerOperation(path: string, op: meta.Operation, operation: amf.model.domain.Operation, pathParams: amf.model.domain.Parameter[]) {
        let endpointOperations = this.endpointsAcc[path] || [];
        endpointOperations.push(operation);
        this.endpointsAcc[path] = endpointOperations;
        // assign path params for the resource path
        this.endpointsParamsAcc[path] = pathParams;
        // assign the operations for this resource path
        let opsEndpoint = this.endpointModelingOpAcc[path] || [];
        opsEndpoint.push(op)
        this.endpointModelingOpAcc[path] = opsEndpoint;
    }

    private generateOperationPath(method: string, op: meta.Operation, pathParams: amf.model.domain.Parameter[]) {
        // We need to do this to avoid having duplicated HTTP methods in the same endpoint
        //----------------------------------------------------------------------------------
        // try to generate a unique path / method combination for the operation
        // we first directly the operation under the path
        // then we compose path with the operation name
        // then we counter path+operations names
        // first compute a binding path for the operation

        let path = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_PATH_BINDING, () => {
            return this.resourceToPath(this.resource.name || this.resource.displayName, this.parentPath, op.name);
        });
        pathParams.map(p => p.name.value()).sort().forEach((p) => {
            const v = `{${p}}`
            if (path?.indexOf(v) == -1) {
                path = path + "_" + v // "_" instead of "/" to avoid clashes in paths
            }
        });

        let originalPath = path;
        let key = path + "::" + method;
        let mCounter = 0;
        // We do this to avoid duplicated operations in the same path
        while (this.opDisambg[key]) {
            mCounter++;
            path = `${originalPath}${mCounter}`
            key = `${path}::${method}`;
        }
        this.opDisambg[key] = true;

        return path;
    }

    /**
     * Produces the method for the operation
     * @param op
     * @param operation
     * @private
     */
    private generateOperationMethod(op: meta.Operation, operation: amf.model.domain.Operation) {
        // let's find the operation binding
        let methodName = "Custom";
        let method = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_METHOD_BINDING, (rt : ResourceTransformer) => {
            if (op instanceof meta.CreateOperation) {
                methodName = "Create"
                return "post"
                /*
                if (statusCode == null) {
                    statusCode = "201"
                }
                 */
            } else if (op instanceof meta.DeleteOperation) {
                methodName = "Delete"
                return "delete"
            } else if (op instanceof meta.PatchOperation) {
                methodName = "Patch"
                return "patch"
            } else if (op instanceof meta.UpdateOperation) {
                methodName = "Update"
                return "put"
            } else if (op instanceof meta.ListOperation) {
                methodName = "List"
                return "get"
            } else if (op instanceof meta.ReadOperation) {
                methodName = "Read"
                return "get"
            } else {
                if (op.name === "Create" || op.name === "Delete"){
                    methodName = rt.resource.name || op.name
                } else if (op.name) {
                    methodName = op.name
                } else if (op.isMutation) {
                    methodName = "CustomMutation"
                }
                if (op.isMutation) {
                    if (op.name === "Delete"){
                        return "delete"
                    } else {
                        return "post"
                    }
                } else {
                    return "get"
                }
            }
        });
        operation.withMethod(method.toLowerCase());
        operation.withName(methodName);
    }

    private generateOperationRequest(op: meta.Operation, operation: amf.model.domain.Operation) {
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
                    let shape: amf.model.domain.AnyShape = this.transformScalarRange(input.id(), input.scalarRange);
                    if (input.allowMultiple) {
                        const arrayShape = new amf.model.domain.ArrayShape();
                        arrayShape.withId(shape.id + "_array");
                        arrayShape.withItems(shape)
                        shape = arrayShape
                    }
                    param.withSchema(shape);
                }
                if (input.objectRange) { // this can only be a link in params
                    let shapeLink = this.transformEntity(input.objectRange)
                    if (input.allowMultiple) {
                        const arrayShape = new amf.model.domain.ArrayShape();
                        arrayShape.withId(shapeLink.id + "_array");
                        arrayShape.withItems(shapeLink)
                        shapeLink = arrayShape
                    }
                    param.withSchema(shapeLink);
                }

                // append the parameter to the right binding
                let parameterBinding = this.extractBindingScalarValue(input.id(), VOCAB.API_CONTRACT_OPERATION_PARAMETER_BINDING, () => {
                    if (input.name && op.name!.includes('{'+input.name+'}')) {
                        return "path";
                    } else if (input.objectRange != null) {
                        return "body";
                    } else {
                        return "query";
                    }
                });
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
                req.withCookieParameters(cookieParams);
            }
        }

        return pathParams;
    }

    private generateOperationResponse(op: meta.Operation, operation: amf.model.domain.Operation) {
        if (op.output) {
            let response = operation.withResponse(op.output.name || "response");
            let statusCode = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING, () => "200");
            response.withId(operation.id + "/_response").withStatusCode(statusCode)
            const payload = response.withPayload().withId(response.id + "/payload");
            let mediaType = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING, () => "application/json");
            payload.withMediaType(mediaType)

            // shape
            if (op.output.scalarRange) {
                let shape: amf.model.domain.AnyShape = this.transformScalarRange(response.id, op.output.scalarRange);
                if (op.output.allowMultiple) {
                    let arrayShape = new amf.model.domain.ArrayShape()
                    arrayShape.withId(shape.id + "_array");
                    arrayShape.withItems(shape)
                    shape = arrayShape
                }
                payload.withSchema(shape)
            }
            if (op.output.objectRange) { // this can only be a link in params
                let shape = this.transformEntity(op.output.objectRange)
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
        } else if (operation.method.value() === "get" && this.resource.schema != null || op.output != null) {
            let response = operation.withResponse("response");
            let statusCode = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING, () => "200");
            response.withId(operation.id + "/_response").withStatusCode(statusCode);
            const payload = response.withPayload().withId(response.id + "/payload");
            let mediaType = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING, () =>  "application/json");
            payload.withMediaType(mediaType);

            let shape;
            if (op.output && op.output!.objectRange) {
                shape = this.transformEntity(op.output!.objectRange);
            } else if (this.resource.schema) {
                shape = this.transformEntity(this.resource.schema);
            }
            if (shape instanceof amf.model.domain.AnyShape) {
                payload.withSchema(shape)
            } else {
                throw new Error("Cannot export operation output object range for GET operation " + op.id())
            }
        }
    }

    private extractBindingScalarValue(source: string, declaration: string, or:(rt : ResourceTransformer) => string): string {
        const maybeBinding = this.context.findBinding(source, declaration)
        if (maybeBinding && maybeBinding.configuration && maybeBinding.configuration[0] instanceof BindingScalarValue) {
            const bindingValue = (<BindingScalarValue>maybeBinding.configuration[0]).lexicalValue
            if (bindingValue != null) {
                return bindingValue;
            }

        }
        return or(this);
    }


    /**
     * Transforms the name of the resource as a suffix path for the provided parent path
     * @param resourceName
     * @param parentPath
     */
    private resourceToPath(resourceName: string | undefined, parentPath: string, operationName: string = "") {
        if (resourceName == null) {
            resourceName = this.context.genPath();
        }

        // @ts-ignore
        const n = resourceName.toLowerCase().split(" ").join("_").split("-").join("_");
        const components = n.split("/")
        const encodedPath = components.map((c: string) => encodeURIComponent(c)).join("/")

        if (operationName === 'Create' || operationName === 'Delete'){
            return parentPath
        }
        // The following, for operations without bindings, depends heavily on the names generated by
        // pieces of code, and may need to be revisited.
        if (operationName.length > 0){
            const path = operationName.substring(operationName.lastIndexOf(' ') + 1)
            return path
        }

        return parentPath + "/" + encodedPath;
    }


    private transformEvents(resource: meta.Resource, events: meta.CustomEvent[]) {
        const publishEvents: {[id:string]: amf.model.domain.AnyShape} = {};
        const subscribeEvents: {[id:string]: amf.model.domain.AnyShape} = {};

        events.forEach((event) => {
            if (event.publish != null) {
                let shape = this.transformEventParam(event.publish);
                shape.withName(event.name!)
                // @ts-ignore
                shape.__EVENT = event;
                publishEvents[shape.id] = shape;
            }
            if (event.subscribe != null) {
                let shape = this.transformEventParam(event.subscribe);
                shape.withName(event.name!)
                // @ts-ignore
                shape.__EVENT = event;
                subscribeEvents[shape.id] = shape;
            }
        });

        const operations = [];
        if (Object.keys(publishEvents).length > 0) {
            const operation = this.transformAsyncOperation(resource.id(), "publish", Object.values(publishEvents));
            // @ts-ignore
            operation.__EVENT = Object.values(publishEvents)[0].__EVENT
            operations.push(operation);
        }
        if (Object.keys(subscribeEvents).length > 0) {
            const operation = this.transformAsyncOperation(resource.id(), "subscribe", Object.values(subscribeEvents));
            // @ts-ignore
            operation.__EVENT = Object.values(subscribeEvents)[0].__EVENT
            operations.push(operation);
        }

        return operations;
    }

    private transformAsyncOperation(id: string, method: string, events: amf.model.domain.AnyShape[]) {
        let operation = new amf.model.domain.Operation();
        operation.withId(id + "_" + method);
        operation.withMethod(method);

        // Event payload
        let payloadSchema: amf.model.domain.AnyShape = new amf.model.domain.UnionShape().withAnyOf(events)
        payloadSchema.withXone(events); // for JSON-Schema
        payloadSchema.withId(id + "_defaultUnion")
        if (Object.keys(events).length == 1) {
            payloadSchema = Object.values(events)[0]
        }

        if (method == "subscribe") {
            const response = new amf.model.domain.Response()
            response.withId(id + "_response");
            operation.withResponses([response]);
            response.withPayload().withSchema(payloadSchema);
        } else {
            const request = new amf.model.domain.Request();
            request.withId(id + "_request");
            operation.withRequest(request);
            request.withPayload().withSchema(payloadSchema);
        }
        return operation;
    }

    private transformEventParam(param: meta.OperationParameter): amf.model.domain.AnyShape {
        let shape: amf.model.domain.AnyShape;
        if (param.scalarRange) {
            shape = this.transformScalarRange(param.id(), param.scalarRange);
            if (param.allowMultiple) {
                const arrayShape = new amf.model.domain.ArrayShape();
                arrayShape.withId(shape.id + "_array");
                arrayShape.withItems(shape)
                shape = arrayShape
            }

        }
        if (param.objectRange) { // this can only be a link in params
            shape = this.transformEntity(param.objectRange)
            if (param.allowMultiple) {
                const arrayShape = new amf.model.domain.ArrayShape();
                arrayShape.withId(shape.id + "_array");
                arrayShape.withItems(shape)
                shape = arrayShape
            }
        }
        shape!.withId(param.id())
        return shape!
    }
}