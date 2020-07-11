import * as meta from "@api-modeling/api-modeling-metadata";

export abstract class ExporterBaseUtils {

    protected bindingsIndex: { [source: string]: meta.Binding[] } = {}

    /**
     * Indexing all passed binding applications for easy look-up when processing
     * the data model and modules.
     */
    protected indexBindings(bindings: meta.ModelBindingsDialect[]) {
        bindings.forEach(bindingDialect => {
            const bindingsModel: meta.BindingsModel = <meta.BindingsModel>bindingDialect.encodesWrapper!
            if (bindingsModel) {
                const appliedBindings = bindingsModel.bindings || [];
                appliedBindings.forEach((binding) => {
                    const source = binding.source
                    let applications = this.bindingsIndex[source] || [];
                    applications.push(binding);
                    this.bindingsIndex[source] = applications;
                })
            } else {
                throw new Error(`Bindings Model dialect wrapper without encoded bindings model detected: ${bindingDialect.id}`)
            }
        });
    }

    /**
     * Checks if a particular model element has a binding of the specified declared
     * typed
     * @param source
     * @param declaration
     */
    protected findBinding(source: string, declaration: string): meta.Binding | undefined {
        const maybeBindingApplications = this.bindingsIndex[source];
        if (maybeBindingApplications) {
            return maybeBindingApplications.find((bindingApplication) => {
                return bindingApplication.declaration == declaration
            })
        }
    }

    /**
     * Find values of an specified param in a collection of param values
     * @param values
     * @param parameterId
     */
    protected findParam(values: meta.BindingValue[], parameterId: string) {
        return values.filter((param) => {
            // @ts-ignore
            return param.parameter && param.parameter === parameterId;
        })
    }
}