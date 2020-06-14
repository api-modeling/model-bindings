import {VOCAB} from "./constants";
import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding} from "api-modeling-metadata";
import * as n3 from "n3";

export class CIMExporter {

    /**
     * Find all the subject areas bindings found in a model
     * @param modules
     * @param bindings
     */
    protected findSubjectAreas(modules: ModularityDialect[], bindings: ModelBindingsDialect[]) {
        bindings.map((d) => {
            if (d.encodesWrapper) {
                const bindingsModel = d.encodesWrapper as BindingsModel;
                const subjectAreaModules =  (bindingsModel.bindings || []).filter((binding) => {
                    return (binding.declaration === VOCAB.CIM_BINDINGS_SUBJECT_AREA);
                });
                modules
            } else {
                return [];
            }
        })
    }

}