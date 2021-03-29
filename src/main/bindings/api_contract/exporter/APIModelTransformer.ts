import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {DataModelTransformer} from "./DataModelTransformer";
import {ExportContext} from "./ExportContext";
import {ResourceTransformer} from "./ResourceTransformer";
import {DataEntityTransformer} from "./DataEntityTransformer";

export interface Traversal {
    current: meta.Resource,
    remaining: meta.Resource[],
    baseUnit: amf.model.document.BaseUnit,
    path: string
}

export class APIModelTransformer extends DataModelTransformer {
    private apiModelDialect: meta.ApiModelDialect;
    private baseUnit: amf.model.document.BaseUnit;


    constructor(apiModelDialect: meta.ApiModelDialect, context: ExportContext = new ExportContext()) {
        super(apiModelDialect, context);
        this.apiModelDialect = apiModelDialect;
        this.baseUnit = this.context.baseUnitsIndex[this.apiModelDialect.id]!
    }

    public transformResources() {
        if (this.baseUnit instanceof amf.model.document.Document) {
            const apiModel = this.apiModelDialect.encodedApiModel();
            const entities = (apiModel?.entities||[]).map((entity) => {
                if (entity.adapts != null) {
                    return this.context.generateLink(null, entity.adapts.id(), this.baseUnit.id)
                } else {
                    return new DataEntityTransformer(entity, this.context).transform();
                }
            });
            if (entities.length > 0) {
                this.baseUnit.withDeclares((this.baseUnit.declares || []).concat(entities))
            }
            const webApi = new amf.model.domain.WebApi();
            this.baseUnit.withEncodes(webApi);
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
                remaining: nestedResources,
                path:"",
                baseUnit: this.baseUnit
            }
            this.computeEndpoints(traversal, webApi)
        } else {
            throw new Error(`Cannot export an API model as a ${this.baseUnit.id} base unit, only as a Document`)
        }
    }

    /**
     * Transforms the graph of resources into a flat list of endpoints
     * It stops when all nodes in the resource graph has been processed.
     * @param traversal
     * @param webApi
     */
    private computeEndpoints(traversal: Traversal, webApi: amf.model.domain.WebApi) {

        const resourceTransformer = new ResourceTransformer(traversal, this.context);
        const collectedEndpoints = resourceTransformer.transform()

        collectedEndpoints.forEach((endpoint) => {
            // the endpoint might have been added in the recursive call for nested endpoints
            let existingEndpoint  = webApi.endPoints.find((ep) => ep.path.value() === endpoint.path.value());
            if (existingEndpoint != null) { // merge endpoints
                // update operations
                const oldOperations = existingEndpoint.operations || [];
                endpoint.withOperations(oldOperations.concat(endpoint.operations));

            } else {
                const webApiAcc = webApi.endPoints || [];
                webApi.withEndPoints(webApiAcc.concat([endpoint]));
            }

            // recursive calls for the transitions
            const apiOperations = resourceTransformer.apiOperationsForTransformed(endpoint)
            const transitions = apiOperations.map(op => op.transition).filter(t => t != null && t.target?.uuid != null);
            transitions.forEach(transition => {
                const targetResource = traversal.remaining.find(remainingResource => remainingResource.uuid == transition?.target?.uuid);
                if (targetResource) {
                    // prepare next invocation
                    traversal.current = targetResource;
                    traversal.remaining = traversal.remaining.filter(r => r.uuid != targetResource.uuid)
                    traversal.path = endpoint.path.value();
                    this.computeEndpoints(traversal, webApi);
                }
            });
        });

        // add the new endpoints
        if (traversal.remaining.length > 0) {
            traversal.current = traversal.remaining.shift()!;
            this.computeEndpoints(traversal, webApi);
        }
    }
}