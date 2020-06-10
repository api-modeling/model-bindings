import {BindingsPlugin} from "./BindingsPlugin";
import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding} from "@api-modeling-tooling/api-modeling-metadata";
import * as graph from "./utils/N3Graph";
import {fetchText} from "./utils/Fetcher";
import * as n3 from "n3";
import {N3Store, Quad_Object} from "n3";

export class CIMBindingsPlugin extends BindingsPlugin {

    protected $rdf = n3.DataFactory;
    // namespaces
    protected CIM_NS: string = "http://cloudinformationmodel.org/model/";
    protected RDF_NS: string = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    protected RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
    protected SH_NS = "http://www.w3.org/ns/shacl#";
    protected XSD_NS = "http://www.w3.org/2001/XMLSchema#";

    // CIM model
    protected CIM_SUBJECT_AREA =  this.$rdf.namedNode(this.CIM_NS + 'SubjectArea');
    protected CIM_ENTITTY_GROUPS = this.$rdf.namedNode(this.CIM_NS + 'entityGroup');
    protected CIM_CLASSES = this.$rdf.namedNode(this.CIM_NS + 'classes');
    protected CIM_ID = this.$rdf.namedNode(this.CIM_NS + "id");
    protected RDF_TYPE = this.$rdf.namedNode(this.RDF_NS + "type");
    protected RDF_FIRST = this.$rdf.namedNode(this.RDF_NS + "first");
    protected RDF_REST = this.$rdf.namedNode(this.RDF_NS + "rest");
    protected RDFS_LABEL = this.$rdf.namedNode(this.RDFS_NS + "label");
    protected RDFS_COMMENT = this.$rdf.namedNode(this.RDFS_NS + "comment");
    protected SH_PROPERTY = this.$rdf.namedNode(this.SH_NS + "property");
    protected SH_PATH = this.$rdf.namedNode(this.SH_NS + "path");
    protected SH_DATATYPE = this.$rdf.namedNode(this.SH_NS + "datatype");
    protected SH_NODE = this.$rdf.namedNode(this.SH_NS + "node");
    protected SH_MAX_COUNT = this.$rdf.namedNode(this.SH_NS + "maxCount");
    protected SH_MIN_COUNT = this.$rdf.namedNode(this.SH_NS + "minCount");
    protected SH_AND = this.$rdf.namedNode(this.SH_NS + "and");

    // CIM Bindings
    protected CIM_BINDINGS_PROFILE = "http://mulesoft.com/modeling/instances/bindings/cim";
    protected CIM_BINDINGS_SUBJECT_AREA = "http://mulesoft.com/modeling/instances/bindings/cim/SubjectAreaBinding";
    protected CIM_BINDINGS_ENTITY_GROUP = "http://mulesoft.com/modeling/instances/bindings/cim/EntityGroupBinding";


    constructor() {
        super();
    }

    async import(location: string): Promise<DialectWrapper[]> {
        const store = await this.parseGlobalFile(location);
        const subjectAreasModules: Module[] = await this.parseSubjectAreas(store);
        const entityGroupsModules: Module[] = await this.parseEntityGroups(store, subjectAreasModules);

        subjectAreasModules.forEach(sam => {
            console.log("SA:"+sam.name)
            sam.subModules?.forEach(sub => {
                //console.log("SUB:"+sub.name)
            })
        })

        // Modules
        const topLevel = new Module("CIM Distribution");
        topLevel.uuid = "cim_distribution";
        topLevel.subModules = [];

        const modularityDialect = new ModularityDialect();
        modularityDialect.id = "http://cloudinformationmodel.org/modeling/modules";
        modularityDialect.location = "modules";

        let declarations = subjectAreasModules.map(async (module) => {
            topLevel.subModules!.push(module);
            module.inModule = topLevel.id();
            return modularityDialect.declare(module)
        });
        await Promise.all(declarations);

        declarations = entityGroupsModules.map(async (module) => {
            //topLevel.subModules!.push(module);
            //module.inModule = topLevel.id();
            return modularityDialect.declare(module)
        });
        await Promise.all(declarations);

        await modularityDialect.encode(topLevel);


        // Data Models
        const dataModels: DataModel[] = entityGroupsModules.map((entityGroup) => {
            const entities = this.parseEntityGroup(store, entityGroup);
            const dataModel = new DataModel(entityGroup.id());
            dataModel.uuid = entityGroup.uuid + "/dataModel";
            dataModel.entities =  entities;
            return dataModel;
        });

        const allModels = dataModels.map(async (dataModel) => {
            const dataModelId = dataModel.id().replace("/dataModel", "").split("/").pop();
            const dataModelDialect = new DataModelDialect();
            dataModelDialect.id = `http://cloudinformationmodel.org/modeling/${dataModelId}`;
            dataModelDialect.location = `data_models/${dataModelId}`;
            await dataModelDialect.encode(dataModel);
            return dataModelDialect;
        });
        const dataModelDialects = await Promise.all(allModels);


        // Bindings
        const entityGroupsBindings: Binding[] = this.parseEntityGroupsBindings(entityGroupsModules);
        const subjectAreasBindings: Binding[] = this.parseSubjectAreasBindings(subjectAreasModules);
        const bindingsModel: BindingsModel = new BindingsModel();
        bindingsModel.uuid = "cim/bindings/modules";
        bindingsModel.source = topLevel.id();
        bindingsModel.declaration = this.CIM_BINDINGS_PROFILE;
        bindingsModel.bindings = subjectAreasBindings.concat(entityGroupsBindings);

        const moduleBindings = new ModelBindingsDialect();
        moduleBindings.id = "http://cloudinformationmodel.org/modeling/modules_bindings";
        moduleBindings.location = "modules_bindings";
        await  moduleBindings.encode(bindingsModel);

        return ([modularityDialect]).concat(dataModelDialects).concat(moduleBindings);
    }

    protected async parseGlobalFile(location: string): Promise<n3.N3Store> {
        const text = await fetchText(location);
        return await graph.loadGraph(text);
    }

    protected async parseSubjectAreas(store: n3.N3Store): Promise<Module[]> {
        let subjectAreas = store.getSubjects(this.RDF_TYPE, this.CIM_SUBJECT_AREA, null);
        return subjectAreas.map((id) => {
            const name = store.getObjects(id, this.RDFS_LABEL, null)[0];
            const description = store.getObjects(id, this.RDFS_COMMENT, null)[0];
            const module = new Module(name.value);
            module.description = description.value;
            module.uuid = `cim/subjectarea/${name.value}`;
            // @ts-ignore
            module['_source'] = id.value;
            return module
        });
    }

    protected parseSubjectAreasBindings(subjectAreas: Module[]): Binding[] {
        return subjectAreas.map((subjectArea) => {
            const subjectAreaId = subjectArea.id();
            const binding = new Binding(subjectAreaId, this.CIM_BINDINGS_SUBJECT_AREA)
            const subjectAreaName = subjectAreaId.split("/").pop();
            binding.uuid = `cim/bindings/subjectArea/${subjectAreaName}`
            return binding
        });
    }

    protected parseEntityGroups(store: n3.N3Store, subjectAreas: Module[]): Module[] {
        const acc: Module[] = [];
        subjectAreas.forEach((subjectArea) => {
            // @ts-ignore
            const source = this.$rdf.namedNode(subjectArea['_source']);
            const entityGroupIds = store.getObjects(source, this.CIM_ENTITTY_GROUPS, null);
            subjectArea.subModules = [];
            entityGroupIds.forEach((id) => {
                const name = store.getObjects(id, this.RDFS_LABEL, null)[0];
                const description = store.getObjects(id, this.RDFS_COMMENT, null)[0];
                const module = new Module(name.value);
                module.description = description.value;
                module.uuid = `cim/entitygroup/${id.value.split("/").pop()}`;
                module.inModule = source.value;
                subjectArea.subModules!.push(module);
                // @ts-ignore
                module['_source'] = id.value;
                acc.push(module);
            })
        });

        return acc;
    }

    protected parseEntityGroupsBindings(entityGroups: Module[]): Binding[] {
        return entityGroups.map((entityGroup) => {
            const entityGroupId = entityGroup.id();
            const binding = new Binding(entityGroupId, this.CIM_BINDINGS_ENTITY_GROUP)
            const subjectAreaName = entityGroupId.split("/").pop();
            binding.uuid = `cim/bindings/entityGroup/${subjectAreaName}`
            return binding
        });
    }

    private parseEntityGroup(store: N3Store, entityGroup: Module): Entity[] {
        // @ts-ignore
        const entityGroupId = entityGroup['_source'];
        const source = this.$rdf.namedNode(entityGroupId);
        const entityIds = store.getObjects(source, this.CIM_CLASSES, null);
        return entityIds.map((entityId) => {
            const name = store.getObjects(entityId, this.RDFS_LABEL, null)[0];
            const entity = new Entity(name.value);
            entity.uuid = `cim/entity/${entityId.value.split("/").pop()}`;

            const description = store.getObjects(entityId, this.RDFS_COMMENT, null)[0];
            entity.description = description.value;

            let properties = store.getObjects(entityId, this.SH_PROPERTY, null);
            let parentProperties = this.findPath(store, entityId, [this.SH_AND, this.RDF_FIRST, this.SH_PROPERTY]) || [];
            let extendedProperties = this.findPath(store, entityId, [this.SH_AND, this.RDF_REST, this.RDF_FIRST, this.SH_PROPERTY]) || [];

            const attributes: Attribute[] = [];
            const associations: Association[] = [];
            (properties.concat(parentProperties).concat(extendedProperties)).forEach((propertyId) => {

                const path = store.getObjects(propertyId, this.SH_PATH, null)[0];
                const name = path.value.split("/").pop()!;
                const displayName = store.getObjects(path, this.RDFS_LABEL, null)[0];
                const description = store.getObjects(path, this.RDFS_COMMENT, null)[0];
                const dataType = store.getObjects(propertyId, this.SH_DATATYPE, null)[0];
                const node = store.getObjects(propertyId, this.SH_NODE, null)[0];
                const minCount = store.getObjects(propertyId, this.SH_MIN_COUNT, null)[0];
                const maxCount = store.getObjects(propertyId, this.SH_MAX_COUNT, null)[0];

                if (dataType && dataType.value.startsWith(this.XSD_NS + "integer")) {
                    const attribute = new Attribute(name, new IntegerScalar());
                    this.genUUID(attribute, entity, path);
                    this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                    attributes.push(attribute)
                } else if (dataType && dataType.value.startsWith(this.XSD_NS)) {
                    const attribute = new Attribute(name, new StringScalar());
                    this.genUUID(attribute, entity, path);
                    this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                    attributes.push(attribute)
                } else if (dataType && dataType.value === this.CIM_ID.value) {
                    const attribute = new Attribute(name, new StringScalar());
                    this.genUUID(attribute, entity, path);
                    this.fillPropertyData(attribute, minCount, maxCount, description, displayName);
                    attributes.push(attribute)
                } else if (node) {
                    const association = new Association(name);
                    this.genUUID(association, entity, path);
                    this.fillPropertyData(association, minCount, maxCount, description, displayName);
                    const targetEntity = new Entity("");
                    targetEntity.uuid = `cim/entity/${node.value.split("/").pop()}`;
                    association.target = targetEntity.id();
                    associations.push(association)
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

    protected genUUID(prop: Attribute|Association, entity: Entity, path: Quad_Object) {
        const base = entity.uuid;
        const propId = path.value.split("/").pop();
        prop.uuid = `${base}/attr/${propId}`;
    }

    protected fillPropertyData(prop: Attribute|Association, minCount: Quad_Object, maxCount: Quad_Object, description: Quad_Object, displayName: Quad_Object) {
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

    protected findPath(store: N3Store, subject: Quad_Object, path: Quad_Object[]): Quad_Object|null {
        const next = path.shift()!;
        const nextSubject = store.getObjects(subject, next, null)[0];
        if (nextSubject) {
            if (path.length === 0) {
                return nextSubject;
            } else {
                return this.findPath(store, nextSubject, path);
            }
        } else {
            return null;
        }
    }
}