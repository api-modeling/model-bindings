import * as amf from "@api-modeling/amf-client-js";
import * as meta from "@api-modeling/api-modeling-metadata";
import {APIModelQueries as $apiModel} from "./APIModelQueries";

export class ExportContext {

    private pathCounter: number = 0;
    protected bindingsIndex: { [source: string]: meta.Binding[] } = {}

    constructor(dataModels: meta.DataModelDialect[] = []) {
        this.dataModels = dataModels;
    }

    private readonly entitiesIndex: { [id: string]: meta.Entity } = {};
    public readonly baseUnitsIndex: { [id: string]: amf.model.document.BaseUnit } = {};
    public readonly baseUnitAliases: { [id: string]: string} = {};
    public readonly references: { [source: string]: amf.model.document.BaseUnit[]} = {};
    public readonly entityToBaseUnitIndex: { [entityId: string]: string } = {};
    public readonly dataModels: meta.DataModelDialect[] = [];
    public readonly apiShapeDeclarations: { [id: string]: amf.model.domain.Shape} = {}

    public toAlias(name: string) {
        return name.toLowerCase().replace(" ", "_").replace(".", "_");
    }

    public registerAPIShapeDeclaration(shape: amf.model.domain.DomainElement) {
        this.apiShapeDeclarations[shape.id] = <amf.model.domain.Shape>shape;
    }

    /**
     * Generate an internal map from the entities in the model to the BaseUnit where it should be encoded.
     * Allow us to navigate between modeling tool models and the APIContract we are generating
     * @param baseUnit
     * @param dataModel
     */
    public indexBaseUnit(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel|meta.ApiModel) {
        this.baseUnitsIndex[baseUnit.id] = baseUnit;
        (dataModel.entities || []).forEach((entity) => {
            this.entityToBaseUnitIndex[entity.id()] = baseUnit.id;
            this.entitiesIndex[entity.id()] = entity;
        });
    }

    public indexedEntity(id: string): boolean {
        return this.entitiesIndex[id] != null;
    }

    public findEntityById(id: string): meta.Entity {
        const entity = this.entitiesIndex[id];
        if (entity != null) {
            return entity;
        } else {
            throw new Error(`Cannot find entity with id ${id}`);
        }
    }

    public genPath(): string {
        this.pathCounter++;
        return `path${this.pathCounter}`
    }

    /**
     * Returns theb abase/adapted entity for any given API model entity
     * @param entity
     */
    public effectiveEntity(entity: meta.Entity): meta.Entity {
        if (entity.extends != null && entity.extends.length > 0) {
            return this.findEntityById(entity.extends[0].id());
        } else if (entity.adapts != null) {
            return this.findEntityById(entity.adapts.id());
        } else {
            return entity;
        }
    }

    public generateLink(source: string|null, target: string, sourceBaseUnitId: string|null): amf.model.domain.AnyShape {
        if (sourceBaseUnitId == null && source != null) {
            sourceBaseUnitId = this.entityToBaseUnitIndex[source];
        }
        const targetBaseUnitId = this.entityToBaseUnitIndex[target];
        const targetEntity = this.findEntityById(target)
        let targetShape: amf.model.domain.AnyShape | undefined;

        // This is just to generate the link. The actual shape will be parsed at a later stage (or might have already been parsed)
        if ($apiModel.isNodeShape(this.effectiveEntity(targetEntity))) {
            targetShape = new amf.model.domain.NodeShape().withId(target).withName(targetEntity.name);
        } else if ($apiModel.isUnionShape(targetEntity)) {
            targetShape = new amf.model.domain.UnionShape().withId(target).withName(targetEntity.name);
        } else {
            targetShape = new amf.model.domain.AnyShape().withId(target).withName(targetEntity.name);
        }

        if (targetBaseUnitId == null) {
            throw new Error(`Cannot link target entity without associated target base unit: ${target}`)
        } else if (sourceBaseUnitId != null) {
            if (sourceBaseUnitId === targetBaseUnitId) {
                // local reference
                const link = targetShape.link();
                return <amf.model.domain.AnyShape>link.withName(targetEntity.name).withLinkLabel(targetEntity.name);
            } else {
                // x-baseunit reference: include or library
                const targetBaseUnit = this.baseUnitsIndex[targetBaseUnitId];

                // index references
                const referenced = (this.references[sourceBaseUnitId] || [])
                if (!referenced.find((ref) => ref.id === targetBaseUnit.id)) {
                    referenced.push(targetBaseUnit)
                    this.references[sourceBaseUnitId] = referenced
                }

                // now generate the right kind of link
                if (targetBaseUnit instanceof amf.model.document.Module) {
                    // library
                    const link = targetShape.link();
                    const dataModelDialect = this.dataModels.find((dm) => dm.encodedDataModel()!.id() === targetBaseUnit.id)!
                    const alias = this.toAlias(dataModelDialect.encodedDataModel()!.name!)
                    return <amf.model.domain.AnyShape>link.withName(targetEntity.name).withLinkLabel(`${alias}.${targetEntity.name}`)
                } else if (targetBaseUnit instanceof amf.model.domain.DataType) {
                    // fragment
                    const link = targetShape.link();
                    return <amf.model.domain.AnyShape>link.withName(targetEntity.name).withLinkLabel(`!include ${targetBaseUnit.location}`); // @todo: setup the final URL for the generated unit ahead
                } else {
                    throw new Error(`Cannot reference base unit that is not a Fragment or a Module: ${targetBaseUnitId} from ${sourceBaseUnitId}`)
                }
            }
        } else {
            throw new Error("Cannot link target entity without a valid source base unit for the source");
        }
    }

    /**
     * Indexing all passed binding applications for easy look-up when processing
     * the data model and modules.
     */
    public indexBindings(bindings: meta.ModelBindingsDialect[]) {
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
    public findBinding(source: string, declaration: string): meta.Binding | undefined {
        const maybeBindingApplications = this.bindingsIndex[source];
        if (maybeBindingApplications) {
            return maybeBindingApplications.find((bindingApplication) => {
                return bindingApplication.declaration == declaration
            })
        }
    }

}