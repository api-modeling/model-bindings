import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {VOCAB} from "../constants";
import {Binding, BindingScalarValue} from "@api-modeling/api-modeling-metadata";

export class BindingsBuilder {
    public bindings: meta.Binding[] = [];


    public addOperationBindings(linkedEndpoint: amf.model.domain.EndPoint, operation: amf.model.domain.Operation, linkOperation: meta.Operation) {
        const path = linkedEndpoint.path.value();
        const method = operation.method.value();

        const methodBinding = this.buildStringParameterBinding(
            linkOperation.id(),
            VOCAB.API_CONTRACT_OPERATION_METHOD_BINDING,
            VOCAB.API_CONTRACT_OPERATION_METHOD_BINDING_PARAMETER,
            method.toUpperCase(),
            `api_contract_operation_method_binding/${linkOperation.uuid}`,
            `api_contract_operation_method_binding/param/${linkOperation.uuid}`
        )
        this.bindings.push(methodBinding);

        const pathBinding = this.buildStringParameterBinding(
            linkOperation.id(),
            VOCAB.API_CONTRACT_OPERATION_PATH_BINDING,
            VOCAB.API_CONTRACT_OPERATION_PATH_BINDING_PARAMETER,
            path,
            `api_contract_operation_path_binding/${linkOperation.uuid}`,
            `api_contract_operation_path_binding/param/${linkOperation.uuid}`
        )
        this.bindings.push(pathBinding);
    }

    public addParameterBinding(parsedParam: meta.OperationParameter, httpBinding: string) {
        const parameterBinding = this.buildStringParameterBinding(
            parsedParam.id(),
            VOCAB.API_CONTRACT_OPERATION_PARAMETER_BINDING,
            VOCAB.API_CONTRACT_OPERATION_PARAMETER_BINDING_PARAMETER,
            httpBinding,
            `api_contract_operation_parameter_binding/${parsedParam.uuid}`,
            `api_contract_operation_method_binding/param/${parsedParam.uuid}`
        )
        this.bindings.push(parameterBinding)
    }

    public addResponseBindings(response: amf.model.domain.Response, payload: amf.model.domain.Payload, operation: meta.Operation) {
        const statusCode = response.statusCode.option
        if (statusCode != null) {
            const statusBinding = this.buildStringParameterBinding(
                operation.id(),
                VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING,
                VOCAB.API_CONTRACT_OPERATION_STATUS_CODE_BINDING_PARAMETER,
                statusCode,
                `api_contract_operation_status_code_parameter_binding/${operation.uuid}`,
                `api_contract_operation_status_code_parameter_binding/value/${operation.uuid}`
            )
            this.bindings.push(statusBinding)
        }

        const mediaType = payload.mediaType.option
        if (mediaType != null) {
            const statusBinding = this.buildStringParameterBinding(
                operation.id(),
                VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING,
                VOCAB.API_CONTRACT_OPERATION_MEDIA_TYPE_BINDING_PARAMETER,
                mediaType,
                `api_contract_operation_media_type_parameter_binding/${operation.uuid}`,
                `api_contract_operation_media_type_parameter_binding/value/${operation.uuid}`
            )
            this.bindings.push(statusBinding)
        }
    }

    public addServerBindings(webapi: amf.model.domain.WebApi, apiModel: meta.ApiModel) {
        const urls = (webapi.servers || []).map((s) => s.url.option).filter((url) => url != null);
        if (urls.length > 0) {
            const statusBinding = this.buildStringParameterBinding(
                apiModel.id(),
                VOCAB.API_CONTRACT_SERVER_URL_BINDING,
                VOCAB.API_CONTRACT_SERVER_URL_BINDING_PARAMETER,
                urls[0]!,
                `api_contract_operation_server_url_parameter_binding/${apiModel.uuid}`,
                `api_contract_operation_server_url_parameter_binding/value/${apiModel.uuid}`
            )
            this.bindings.push(statusBinding)
        }
    }

    private buildStringParameterBinding(sourceId: string, declarationId: string, paramDeclarationId: string, paramValue: string, UUID: string, paramUUID: string) {
        const binding = new Binding(sourceId, declarationId)
        binding.uuid = UUID
        const parameterBinding = new BindingScalarValue()
        parameterBinding.parameter = paramDeclarationId
        parameterBinding.uuid = paramUUID
        parameterBinding.lexicalValue = paramValue;
        binding.configuration =[
            parameterBinding
        ];

        return binding;
    }

}