import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {ExporterBaseUtils} from "../utils/ExporterBaseUtils";
import {VOCAB} from "./constants";
import {ExportContext} from "./exporter/ExportContext";
import {DataModelTransformer} from "./exporter/DataModelTransformer";
import {APIModelTransformer} from "./exporter/APIModelTransformer";

export class APIContractExporter extends ExporterBaseUtils {


    private readonly modules: meta.ModularityDialect[];
    private readonly apiModels: meta.ApiModelDialect[];
    private readonly bindings: meta.ModelBindingsDialect[];
    private readonly formatExtension: string;

    private context: ExportContext;

    constructor(modules: meta.ModularityDialect[], dataModels: meta.DataModelDialect[], apiModels: meta.ApiModelDialect[], bindings: meta.ModelBindingsDialect[], formatExtension: string) {
        super()
        this.modules = modules;
        this.context = new ExportContext(dataModels);
        this.apiModels = apiModels;
        this.bindings = bindings;
        this.formatExtension = formatExtension;
    }

    export(): amf.model.document.BaseUnit[] {
        this.context.indexBindings(this.bindings)
        const dataModels = this.exportDataModels();
        const apiModels = this.exportApiModels();
        return dataModels.concat(apiModels);
    }

    exportDataModels(): amf.model.document.BaseUnit[] {
        const dataModels = this.findDataModelsToExport()
        // Index
        const baseUnits = dataModels.map(dataModelDialect => {
            const baseUnit = this.exportBaseUnit(dataModelDialect);
            this.context.indexBaseUnit(baseUnit, dataModelDialect.encodedDataModel()!)
            return baseUnit;
        });
        // Export
        dataModels.forEach((dataModelDialect) => {
            const entityTransformer = new DataModelTransformer(dataModelDialect, this.context);
            entityTransformer.transformDataEntities();
        });
        // References
        baseUnits.forEach((baseUnit) => {
            const referenced = this.context.references[baseUnit.id]
            if (referenced != null) {
                baseUnit.withReferences(referenced)
                referenced.forEach((ref) => {
                    const alias = this.context.baseUnitAliases[ref.id]!;
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
            this.context.indexBaseUnit(baseUnit, apiModel)
            return baseUnit;
        });
        // Export
        apiModels.map((apiModelDialect) => {
            const resourceTransformer = new APIModelTransformer(apiModelDialect, this.context)
            resourceTransformer.transformResources()
        });
        // References
        baseUnits.forEach((baseUnit) => {
            const referenced = this.context.references[baseUnit.id]
            if (referenced != null) {
                baseUnit.withReferences(referenced)
                referenced.forEach((ref) => {
                    const alias = this.context.baseUnitAliases[ref.id]!;
                    baseUnit.withReferenceAlias(alias, ref.id, ref.location)
                });
            }
        });

        return baseUnits;
    }

    protected findDataModelsToExport() {
        return this.context.dataModels.filter((dataModelDialect) => {
            if (dataModelDialect.encodedDataModel()) {
                const dataModel = dataModelDialect.encodedDataModel()!;
                return this.context.findBinding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING) != null;
            } else {
                return false
            }
        });
    }

    protected findApiModelsToExport() {
        return this.apiModels.filter((apiModelDialect) => {
            if (apiModelDialect.encodedApiModel()) {
                const apiModel = apiModelDialect.encodedApiModel()!;
                return this.context.findBinding(apiModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING) != null;
            } else {
                return false
            }
        });
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

        const binding = this.context.findBinding(modelId, VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING)!

        // register the alias to support references from other specs
        const baseUnitAlias = this.context.toAlias(modelName);
        this.context.baseUnitAliases[modelId] = baseUnitAlias;

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


}