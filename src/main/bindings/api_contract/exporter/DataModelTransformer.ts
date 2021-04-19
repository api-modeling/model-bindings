import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {VOCAB} from "../constants";
import {ExportContext} from "./ExportContext";
import {ExporterBaseUtils} from "../../utils/ExporterBaseUtils";
import {DataEntityTransformer} from "./DataEntityTransformer";

/**
 * Logic to transform DataEntities from the modeling tool DataModel
 * into AMF data shapes that then cn be encoded into API specifications, libraries
 * or fragments
 */
export class DataModelTransformer extends ExporterBaseUtils {

    private declarations: meta.Entity[] = [];
    protected context: ExportContext;
    private dataModelDialect: meta.DataModelDialect;

    constructor(dataModelDialect: meta.DataModelDialect, context: ExportContext = new ExportContext()) {
        super();
        this.dataModelDialect = dataModelDialect;
        this.context = context;
    }

    public transformDataEntities(): amf.model.document.BaseUnit {
        const dataModel = this.dataModelDialect.encodedDataModel()
        this.declarations = (dataModel && dataModel.entities || [])

        const shapes = this.declarations.map((entity) => new DataEntityTransformer(entity, this.context).transform());

        const baseUnit = this.context.baseUnitsIndex[this.dataModelDialect.id]!
        if (baseUnit instanceof amf.model.document.Document) {
            return (<amf.model.document.Document>baseUnit).withDeclares(shapes);
        } else if (baseUnit instanceof amf.model.document.Module) {
            return (<amf.model.document.Module>baseUnit).withDeclares(shapes);
        } else {
            const binding = this.context.findBinding(this.dataModelDialect.encodedDataModel()!.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING)!
            const params: meta.BindingValue[] = (binding.configuration || []);
            const bindingValues = this.findParam(params, VOCAB.API_CONTRACT_DOCUMENT_TARGET_ENTITY_PARAMETER)
            if (bindingValues.length === 1) {
                const encodedEntityId = (<meta.BindingScalarValue>bindingValues[0]).lexicalValue;
                const encodedShape = shapes.find((s) => {
                        return s.id === encodedEntityId
                })!;
                return (<amf.model.domain.DataType>baseUnit).withEncodes(encodedShape)
            } else {
                throw new Error("Cannot generate data type fragment with multiple shapes");
            }
        }
    }
}