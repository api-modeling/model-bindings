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

        return Object.keys(this.endpointsAcc).map((path) => {
            const operations = this.endpointsAcc[path];
            const endpoint = new amf.model.domain.EndPoint();
            endpoint
                .withId(this.traversal.current.id() + path.replace("/", "_"))
                .withPath(path)
            endpoint.withOperations(operations);
            const pathParams = this.endpointsParamsAcc[path]

            if (pathParams && pathParams.length != 0) {
                endpoint.withParameters(pathParams);
            }
            return endpoint;
        });
    }

    public apiOperationsForTransformed(endpoint: amf.model.domain.EndPoint) {
        return this.endpointModelingOpAcc[endpoint.path.value()] || [];
    }

    private transformOperation(op: meta.Operation) {
        let operation = new amf.model.domain.Operation();
        operation.withId(op.id());
        this.generateElementName(op.name, op.description, operation)
        // @todo: create annotations/extensions here for the standard operations
        // const customDomainProperties: amf.model.domain.CustomDomainProperty[] = [];
        const methodName = this.generateOperationMethod(op, operation);
        const pathParams = this.generateOperationRequest(op, operation);
        this.generateOperationResponse(op, operation);
        let path = this.generateOperationPath(methodName, op, pathParams);
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

    private generateOperationPath(methodName: string, op: meta.Operation, pathParams: amf.model.domain.Parameter[]) {
        // We need to do this to avoid having duplicated HTTP methods in the same endpoint
        //----------------------------------------------------------------------------------
        // try to generate a unique path / method combination for the operation
        // we first directly the operation under the path
        // then we compose path with the operation name
        // then we counter path+operations names
        // first compute a binding path for the operation

        let path = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_PATH_BINDING, () => {
            return this.resourceToPath(this.resource.name || this.resource.displayName, this.parentPath);
        });
        pathParams.map(p => p.name.value()).sort().forEach((p) => {
            const v = `{${p}}`
            if (path?.indexOf(v) == -1) {
                path = path + "_" + v // "_" instead of "/" to avoid clashes in paths
            }
        });

        let key = path
        let mCounter = 0;
        // We do this to avoid duplicated operations in the same path
        while (this.opDisambg[key]) {
            mCounter++;
            key = `${path}${mCounter}`;
        }
        this.opDisambg[key] = true;

        return key;
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
        let method = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_METHOD_BINDING, () => {
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
                if (op.name) {
                    methodName = op.name
                } else if (op.isMutation) {
                    methodName = "CustomMutation"
                }
                if (op.isMutation) {
                    return "post"
                } else {
                    return "get"
                }
            }
        });
        operation.withMethod(method.toLowerCase());
        operation.withName(methodName);
        return methodName;
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
                    let shapeLink: amf.model.domain.AnyShape = this.context.generateLink(null, input.objectRange.id(), this.traversal.baseUnit.id)
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
                    if (input.objectRange != null) {
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
                let shape: amf.model.domain.DomainElement;
                if (op.output.objectRange.adapts != null) {
                    shape = this.context.generateLink(null, op.output!.objectRange.adapts.id(), this.traversal.baseUnit.id)
                } else {
                    shape = new DataEntityTransformer(op.output.objectRange, this.context).transform();
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
        } else if (operation.method.value() === "get" && this.resource.schema != null || op.output != null) {
            let response = operation.withResponse("response");
            let statusCode = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING, () => "200");
            response.withId(operation.id + "/_response").withStatusCode(statusCode);
            const payload = response.withPayload().withId(response.id + "/payload");
            let mediaType = this.extractBindingScalarValue(op.id(), VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING, () =>  "application/json");
            payload.withMediaType(mediaType);

            let shape;
            if (op.output != null && op.output!.objectRange != null && op.output!.objectRange.adapts != null) {
                shape = this.context.generateLink(null, op.output!.objectRange.adapts.id(), this.traversal.baseUnit.id);
            } else if (op.output && op.output!.objectRange != null) {
                shape = this.context.generateLink(null, op.output!.objectRange.id(), this.traversal.baseUnit.id);
            } else if (this.resource.schema && this.resource.schema.adapts) {
                shape = this.context.generateLink(null, this.resource.schema.adapts.id(), this.traversal.baseUnit.id);
            } else if (this.resource.schema != null) {
                shape = new DataEntityTransformer(this.resource.schema, this.context).transform();
            }

            if (shape instanceof amf.model.domain.AnyShape) {
                payload.withSchema(shape)
            } else {
                throw new Error("Cannot export operation output object range for GET operation " + op.id())
            }
        }
    }

    private extractBindingScalarValue(source: string, declaration: string, or:() => string): string {
        const maybeBinding = this.context.findBinding(source, declaration)
        if (maybeBinding && maybeBinding.configuration && maybeBinding.configuration[0] instanceof BindingScalarValue) {
            const bindingValue = (<BindingScalarValue>maybeBinding.configuration[0]).lexicalValue
            if (bindingValue != null) {
                return bindingValue;
            }

        }
        return or();
    }


    /**
     * Transforms the name of the resource as a suffix path for the provided parent path
     * @param resourceName
     * @param parentPath
     */
    private resourceToPath(resourceName: string | undefined, parentPath: string) {
        if (resourceName == null) {
            resourceName = this.context.genPath();
        }

        // @ts-ignore
        const n = resourceName.toLowerCase().split(" ").join("_").split("-").join("_");
        const components = n.split("/")
        const encodedPath = components.map((c: string) => encodeURIComponent(c)).join("/")

        return parentPath + "/" + encodedPath;
    }



}