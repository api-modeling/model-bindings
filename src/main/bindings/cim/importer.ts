import {VOCAB} from "./constants";
import {DataModel, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, Binding} from "@api-modeling/api-modeling-metadata";
import * as n3 from "n3";
import {$rdf, findPath} from "../utils/N3Graph";

export class CIMImporter {

    /**
     * Generates a UUID for a new entity attribute parsed out of a CIM property
     * @param prop
     * @param entity
     * @param path
     */
    protected genUUID(prop: Attribute|Association, entity: Entity, path: n3.Quad_Object) {
        const base = entity.uuid;
        const propId = path.value.split("/").pop();
        const propIdFin = propId ? propId.replace(' ','_') : propId;
        prop.uuid = `${base}/attr/${propIdFin}`;
    }

    /**
     * Sets the facets for an attribute parsed out of CIM property
     * @param prop
     * @param minCount
     * @param maxCount
     * @param description
     * @param displayName
     */
    protected fillPropertyData(prop: Attribute|Association, minCount: n3.Quad_Object, maxCount: n3.Quad_Object, description: n3.Quad_Object, displayName: n3.Quad_Object) {
        if (minCount && minCount.value == "1") {
            prop.required = true
        }
        if (!maxCount) {
            prop.allowMultiple = true
        }

        if (description) {
            prop.description = description.value;
        }

        if (displayName) {
            prop.displayName = displayName.value;
        }
    }

    /**
     * Parses all the subject areas in a CIM model and generates modeling Modules
     * @param store
     */
    protected async parseSubjectAreas(store: n3.N3Store): Promise<Module[]> {
        let subjectAreas = store.getSubjects(VOCAB.RDF_TYPE, VOCAB.CIM_SUBJECT_AREA, null);
        return subjectAreas.map((id) => {
            const name = store.getObjects(id, VOCAB.RDFS_LABEL, null)[0];
            const description = store.getObjects(id, VOCAB.RDFS_COMMENT, null)[0];
            const module = new Module(name.value);
            module.description = description.value;
            const toReplace = name.value ? name.value.replace(' ','_') : name.value
            module.uuid = `cim/subjectarea/${toReplace}`;
            // @ts-ignore
            module['_source'] = id.value;
            return module
        });
    }

    /**
     * Parses all the bindings for the parsed modules out of CIM subject areas
     * @param subjectAreas
     */
    protected parseSubjectAreasBindings(subjectAreas: Module[]): Binding[] {
        return subjectAreas.map((subjectArea) => {
            const subjectAreaId = subjectArea.id();
            const binding = new Binding(subjectAreaId, VOCAB.CIM_BINDINGS_SUBJECT_AREA)
            const subjectAreaName = subjectAreaId.split("/").pop();
            const toReplace = subjectAreaName ? subjectAreaName.replace(' ','_') : subjectAreaName;
            binding.uuid = `cim/bindings/subjectArea/${toReplace}`
            return binding
        });
    }

    /**
     * Parses all the entity groups in a CIM model, link them to subject areas and return the list of parsed modeling modules
     * @param store
     * @param subjectAreas
     */
    protected parseEntityGroups(store: n3.N3Store, subjectAreas: Module[]): DataModel[] {
        const acc: DataModel[] = [];
        subjectAreas.forEach((subjectArea) => {
            // @ts-ignore
            const source = $rdf.namedNode(subjectArea['_source']);
            const entityGroupIds = store.getObjects(source, VOCAB.CIM_ENTITTY_GROUPS, null);
            subjectArea.dataModels = [];
            entityGroupIds.forEach((id) => {
                const name = store.getObjects(id, VOCAB.RDFS_LABEL, null)[0];
                const description = store.getObjects(id, VOCAB.RDFS_COMMENT, null)[0];
                const dataModel = new DataModel(subjectArea.id());
                dataModel.name = name.value
                dataModel.description = description.value;
                const inter = id.value.split("/").pop();
                const toReplace = inter?.replace(' ','_');
                dataModel.uuid = `cim/entitygroup/${toReplace}`;
                subjectArea.dataModels!.push(dataModel.id());
                // @ts-ignore
                dataModel['_source'] = id.value;
                acc.push(dataModel);
            })
        });

        return acc;
    }

    /**
     * Parses all the bindings for the parsed modules out of CIM entity groups
     * @param entityGroups
     */
    protected parseEntityGroupsBindings(entityGroups: DataModel[]): Binding[] {
        return entityGroups.map((entityGroup) => {
            const entityGroupId = entityGroup.id();
            const binding = new Binding(entityGroupId, VOCAB.CIM_BINDINGS_ENTITY_GROUP)
            const subjectAreaName = entityGroupId.split("/").pop();
            const toReplace = subjectAreaName ? subjectAreaName.replace(' ','_') : subjectAreaName;
            binding.uuid = `cim/bindings/entityGroup/${toReplace}`
            return binding
        });
    }

    /**
     * Parses all the entities in a CIM entity group and returns the generated modeling entities
     * @param store
     * @param entityGroup
     */
    protected parseEntityGroup(store: n3.N3Store, entityGroup: DataModel): Entity[] {
        // @ts-ignore
        const entityGroupId = entityGroup['_source'];
        const source = $rdf.namedNode(entityGroupId);
        const entityIds = store.getObjects(source, VOCAB.CIM_CLASSES, null);
        return entityIds.map((entityId) => {
            const name = store.getObjects(entityId, VOCAB.RDFS_LABEL, null)[0];
            const entity = new Entity(name.value);
            entity.uuid = `cim/entity/${entityId.value.split("/").pop()}`;

            const description = store.getObjects(entityId, VOCAB.RDFS_COMMENT, null)[0];
            entity.description = description.value;

            let properties = store.getObjects(entityId, VOCAB.SH_PROPERTY, null);
            let parentProperties = findPath(store, entityId, [VOCAB.SH_AND, VOCAB.RDF_FIRST, VOCAB.SH_PROPERTY]) || [];
            let extendedProperties = findPath(store, entityId, [VOCAB.SH_AND, VOCAB.RDF_REST, VOCAB.RDF_FIRST, VOCAB.SH_PROPERTY]) || [];

            const attributes: Attribute[] = [];
            const associations: Association[] = [];
            const disambg: {[key:string]: boolean} = {};
            (properties.concat(parentProperties).concat(extendedProperties)).forEach((propertyId) => {

                const path = store.getObjects(propertyId, VOCAB.SH_PATH, null)[0];
                const name = path.value.split("/").pop()!;
                const displayName = store.getObjects(path, VOCAB.RDFS_LABEL, null)[0];
                const description = store.getObjects(path, VOCAB.RDFS_COMMENT, null)[0];
                const dataType = store.getObjects(propertyId, VOCAB.SH_DATATYPE, null)[0];
                const node = store.getObjects(propertyId, VOCAB.SH_NODE, null)[0];
                const minCount = store.getObjects(propertyId, VOCAB.SH_MIN_COUNT, null)[0];
                const maxCount = store.getObjects(propertyId, VOCAB.SH_MAX_COUNT, null)[0];

                if (disambg[name] == null) {
                    disambg[name] = true;
                    if (dataType && dataType.value.startsWith(VOCAB.XSD_NS + "integer")) {
                        const attribute = new Attribute(name, new IntegerScalar());
                        this.genUUID(attribute, entity, path);
                        this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                        attributes.push(attribute)
                    } else if (dataType && dataType.value.startsWith(VOCAB.XSD_NS)) {
                        const attribute = new Attribute(name, new StringScalar());
                        this.genUUID(attribute, entity, path);
                        this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                        attributes.push(attribute)
                    } else if (dataType && dataType.value === VOCAB.CIM_ID.value) {
                        const attribute = new Attribute(name, new StringScalar());
                        this.genUUID(attribute, entity, path);
                        this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                        attributes.push(attribute)
                    } else if (node) {
                        const association = new Association(name);
                        this.genUUID(association, entity, path);
                        this.fillPropertyData(association, minCount, maxCount, description, displayName);
                        const targetEntity = new Entity("");
                        const inter = node.value.split("/").pop()
                        const toReplace = inter ? inter.replace(' ','_') : inter
                        targetEntity.uuid = `cim/entity/${toReplace}`;
                        association.target = targetEntity.id();
                        associations.push(association)
                    }
                }
            });

            if (attributes.length > 0) {
                entity.attributes = attributes;
            }
            if (associations.length > 0) {
                entity.associations = associations;
            }
            return entity
        });
    }
}