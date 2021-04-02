import * as amf from "@api-modeling/amf-client-js";
import {Md5} from "ts-md5/dist/md5";

/**
 * Helper utilities to query and extract information from the AMF API model
 */
export class AMFModelQueries {

    public static isScalarShape(shape: amf.model.domain.Shape): boolean {
        return shape instanceof amf.model.domain.ScalarShape;
    }

    /**
     * Shapes we cannot transform
     * @param shape
     */
    public static isIgnoredShape(shape: amf.model.domain.Shape): boolean {
        if (shape instanceof amf.model.domain.FileShape || shape instanceof amf.model.domain.AnyShape) {
            return true;
        }

        return false;
    }

    /**
     * Checks that a shape can be transformed into an modeling Entity
     * @param shape
     */
    public static isObjectShape(shape: amf.model.domain.Shape): boolean {
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

    /**
     * Checks if this is a Shape|nil union that can be rewritten as an optional Shape
     * @param shape
     */
    public static isNilUnion(shape: amf.model.domain.UnionShape): boolean {
        if ((shape.anyOf||[]).length === 2) {
            const notNil = shape.anyOf.filter((s) => {
                return s instanceof amf.model.domain.NilShape
            });

            return notNil.length === 1;
        } else {
            return false;
        }
    }

    /**
     * Extracts the node in a Shape|nil union
     * @param shape
     * @private
     */
    public static extractFromNilUnion(shape: amf.model.domain.UnionShape): amf.model.domain.Shape {
        const notNil = shape.anyOf.filter((s) => {
            return s instanceof amf.model.domain.NilShape
        });

        return notNil[0]!
    }


    /**
     * Checks that a shape can be transformed into a modeling Scalar value
     * @param shape
     */
    public static getShapeName(shape: amf.model.domain.Shape, hint: string = "Entity"): string|null {
        const name = shape.displayName.option || shape.name.option ;
        if (name != null && name !== "type" && name !== "schema") {
            return name;
        } else {
            return null;
        }
    }

    public static isLink(domainElement: amf.model.domain.DomainElement) {
        if (domainElement instanceof amf.model.domain.AnyShape) {
            const anyShape = <amf.model.domain.AnyShape>domainElement;
            return anyShape.isLink;
        } else {
            return false;
        }
    }

    public static isResource(endpoint: amf.model.domain.EndPoint) {
        if (AMFModelQueries.isRedirection(endpoint)) {
            return false;
        } else if (AMFModelQueries.isImplicitResource(endpoint)) {
            AMFModelQueries.generateDefaultResource(endpoint);
            return true;
        } else {
            return true;
        }
    }

    // Fill default GET and/or Any schema response
    private static generateDefaultResource(endpoint: amf.model.domain.EndPoint) {
        let get = endpoint.operations.find((op) => op.method.value() === "get");
        if (get == null) {
            get = endpoint.withOperation("get");
        }

        const resp = get.withResponse("default");
        resp.withStatusCode("200").withPayload().withObjectSchema(`DefaultPayload ${Md5.hashStr(endpoint.id).toString().substring(-5, endpoint.id.length)}`);
    }

    public static isDefaultOperation(operation: amf.model.domain.Operation) {
        const defaultResponse = operation.responses.length == 1 &&
            operation.responses[0].name.value() == "default" &&
            operation.responses[0].payloads != null &&
            operation.responses[0].payloads.length == 1 &&
            operation.responses[0].statusCode.value() == "200"
        if (defaultResponse) {
            const payload = operation.responses[0].payloads[0];
            const defaultPayload = payload.schema.name.value().startsWith("DefaultPayload ") &&
                payload.schema instanceof amf.model.domain.NodeShape;
            return defaultPayload && defaultResponse;
        }
        return false;
    }

    public static isAsyncChannel(endpoint: amf.model.domain.EndPoint) {
        let operations = endpoint.operations;
        if (operations.length > 3 || operations.length < 2) { // default operation + pub/sub
            return false;
        }
        for (let i=0; i<operations.length; i++) {
            let operation = operations[i];
            if (!this.isDefaultOperation(operation) && !this.isAsyncOperation(operation)) {
                return false;
            }
        }
        return true;
    }

    // Check if this is a resource without operations or empty GET request
    private static isImplicitResource(endpoint: amf.model.domain.EndPoint) {
        let isGet = endpoint.operations.length == 1 && endpoint.operations[0].method.value() == "get";
        let is2xx = false;
        if (isGet) {
            const resp2xx = endpoint.operations[0].responses.find((r) => r.statusCode.value().startsWith("2"));
            if (resp2xx) {
                is2xx = true;
            }
        }
        let noOps = endpoint.operations.filter((op) => op.method.value() != "publish" && op.method.value() != "subscribe").length == 0;
        return (isGet && !is2xx) || noOps
    }

    // Resource that just returns a redirection from a single GET request
    private static isRedirection(endpoint: amf.model.domain.EndPoint) {
        let isGet = endpoint.operations.length == 1 && endpoint.operations[0].method.value() == "get";
        if (isGet) {
            let has3xx = endpoint.operations[0].responses.filter((r) => r.statusCode.value().startsWith("3"))
            return has3xx.length === endpoint.operations[0].responses.length
        } else {
            return false;
        }
    }


    public static findOperationByMethod(method: string, endpoint?: amf.model.domain.EndPoint): amf.model.domain.Operation|undefined {
        if (endpoint != null) {
            return (endpoint.operations || []).find((op) => op.method.value() === method)
        }
    }

    public static findResponsesByStatus(status: string[], operation?: amf.model.domain.Operation) {
        if (operation != null) {
            for (let i=0; i< status.length; i++) {
                let resp = operation.responses.find((r) => r.statusCode.value().startsWith(status[i]));
                if (resp != null) {
                    return resp;
                }
            }
        }
    }

    public static findResponseSchema(resp?: amf.model.domain.Response) {
        if (resp != null) {
            const payload = resp.payloads.find((pl) => pl.schema != null)
            if (payload) {
                return payload.schema;
            }
        }
    }

    public static findAsyncOperationSchema(op: amf.model.domain.Operation): amf.model.domain.Shape|null {
        const response = (op.responses||[])[0];
        if (response) {
            const payload = (response.payloads||[])[0];
            if (payload) {
                return payload.schema || null;
            }
        }
        const request = (op.requests||[])[0]
        if (request) {
            const payload = (request.payloads||[])[0];
            if (payload) {
                return payload.schema || null;
            }
        }
        return null;
    }

    static isAsyncOperation(operation: amf.model.domain.Operation) {
        return operation.method.value() == "publish" || operation.method.value() == "subscribe"
    }
    static findAsyncOperations(linkedEndpoint: amf.model.domain.EndPoint) {
        return linkedEndpoint.operations.filter((op) => this.isAsyncOperation(op))
    }

    static findMutableOperations(linkedEndpoint: amf.model.domain.EndPoint) {
        return linkedEndpoint.operations.filter((op) => op.method.value() != "publish" && op.method.value() != "subscribe" && op.method.value() != "get")
    }

    static isUnionLike(shape: amf.model.domain.Shape): boolean {
        if (shape instanceof amf.model.domain.UnionShape) {
            return true;
        } else {
            return (shape.and && shape.and!.length >0) ||
                (shape.or && shape.or!.length >0) ||
                (shape.xone && shape.xone!.length >0)
        }
    }

    static  effectiveUnionLikeMembers(shape: amf.model.domain.Shape): amf.model.domain.Shape[] {
        let members: amf.model.domain.Shape[] = []
        if (shape instanceof amf.model.domain.UnionShape) {
            members = shape.anyOf
        } else {
            members = (shape.and||[]).concat(shape.or||[]).concat(shape.xone||[])
        }
        let computed: amf.model.domain.Shape[] = [];
        members.filter((e) => !(e instanceof  amf.model.domain.NilShape)).forEach((member) => {
            if (this.isUnionLike(member)) {
                computed = computed.concat(this.effectiveUnionLikeMembers(member))
            } else {
                computed.push(member)
            }
        });
        return members;
    }
}