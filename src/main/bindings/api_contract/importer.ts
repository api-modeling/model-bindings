import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {VOCAB} from "./constants";


export class APIContractImporter {


    /**
     * Generates base unit bindings for the parsed BaseUnits in the API AMF model
     * @param baseUnit
     * @param dataModel
     */
    protected parseBaseUnitBindings(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel|meta.ApiModel): meta.Binding {
        const binding = new meta.Binding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING);
        const param = new meta.BindingScalarValue();
        param.parameter = VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING_PARAMETER
        param.uuid = binding.uuid + "param";
        binding.uuid = `apiContract/bindings/DocumentTypeBinding/${dataModel.uuid}`

        // @ts-ignore
        if (dataModel instanceof meta.ApiModel) {
            param.lexicalValue = "Open API Spec / RAML API Spec"
            binding.configuration = [param]
        // @ts-ignore
        } else if (baseUnit.encodes != null && !(baseUnit instanceof amf.model.document.Document)) {
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
}