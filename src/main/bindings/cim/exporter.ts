import {VOCAB} from "./constants";
import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding} from "@api-modeling/api-modeling-metadata";
import * as n3 from "n3";
import {model} from "@api-modeling/amf-client-js";

export class CIMExporter {

    private INT_SCALAR_ID = new IntegerScalar().id();

    /**
     * Find all the subject areas bindings found in a model
     * @param modules
     * @param bindings
     */
    protected findSubjectAreas(moduleDialects: ModularityDialect[], bindings: ModelBindingsDialect[]): Module[] {
        let subjectAreas: Module[] = [];
        let modules = this.getModules(moduleDialects);
        bindings.forEach((d) => {
            if (d.encodesWrapper) {
                const bindingsModel = d.encodesWrapper as BindingsModel;
                const subjectAreaBinding = (bindingsModel.bindings || []).filter((binding) => {
                    return (binding.declaration === VOCAB.CIM_BINDINGS_SUBJECT_AREA);
                });
                const subjectAreasFound = subjectAreaBinding.map((binding) => {
                    const found = modules[binding.source]
                    if (found == null) {
                        throw new Error(`Cannot find module with subject area binding ${binding.source}, binding ID: ${binding.id()}`)
                    }
                    return found;
                });
                subjectAreas = subjectAreas.concat(subjectAreasFound);
            } else {
                return [];
            }
        })
        return subjectAreas;
    }

    protected getModules(moduleDialects: ModularityDialect[]): {[id: string]: Module} {
        let acc: {[id: string]: Module} = {};

        moduleDialects.forEach((moduleDialect) => {
            let remaining = moduleDialect.declaredModules() || []
            const root = moduleDialect.encodedModule();
            if (root != null) {
                remaining.unshift(root)
            }


            while (remaining.length > 0) {
                const next = remaining.shift();
                if (next != null && acc[next.id()] == null) {
                    acc[next.id()] = next;
                    remaining = remaining.concat(next.nested || [])
                }
            }
        });

        return acc;
    }

    protected exportEntityGroup(subjectArea: string, dm: DataModelDialect, version: string, entityLinkingMap: {[id: string]: Entity}) {
        const dataModel = dm.encodedDataModel();
        const propAcc: {[id:string]: string[]} = {};

        if (dataModel != null) {
            const entities = (dataModel.entities||[]);
            const shapes = entities.map((entity) => {
                return this.exportEntityShape(entity, propAcc, entityLinkingMap);
            });
            const classes = entities.map((entity) => {
                return this.exportEntityClass(entity);
            });

            let dataModelId = dataModel.id().split("/").pop()!
            if (dataModel.name) {
                dataModelId = this.toId(dataModel.name)
            }
            const json = {
                "@id": dataModelId + "EntityGroup"
            }
            if (dataModel.name) {
                // @ts-ignore
                json['name'] = dataModel.name;
            }

            // @ts-ignore
            json['@type'] = "EntityGroup";
            // @ts-ignore
            json['version'] = version
            // @ts-ignore
            json['subjectArea'] = {
                '@id': subjectArea
            };

            if (dataModel.description) {
                // @ts-ignore
                json['description'] = dataModel.description
            }
            // @ts-ignore
            json['classConcepts'] = classes;
            // @ts-ignore
            json['propertyConcepts'] = Object.keys(propAcc).map((id) => {
                let domain = propAcc[id];
                return {
                    "@id": id,
                    "@type": "Property",
                    "domain": domain
                }
            });
            // @ts-ignore
            json['schemas'] = shapes

            return json;
        }

    }

    private entityId(entity: Entity) {
        let id = this.toId(entity.name); // @todo we need a binding for this
        if (entity.uuid.indexOf("cim/entity/") > -1) {
            id = entity.uuid.split("cim/entity/").pop()!;
            id = id.split("/").pop()!; // we are concatenating entity group name and entitiy name
        }
        return id;
    }
    private exportEntityShape(entity: Entity, propAcc: {[id: string]: string[]}, entityLinkingMap: {[id: string]: Entity}) {
        const id = this.entityId(entity)
        let json = {
            "@type": "Shape",
            "@id": id,
        };

        const attributes = (entity.attributes || []).map(attr => {
            const path = attr.name
            let json: {[n: string]: any} = {
                "path": path
            };
            if (attr.range.id() === this.INT_SCALAR_ID) {
                json['datatype'] = VOCAB.XSD_NS + "integer";
            } else if (path == "id") {
                json['datatype'] = VOCAB.CIM_NS + "id";
            } else {
                json['datatype'] = VOCAB.XSD_NS + "string";
            }

            if (attr.required) {
                json[VOCAB.SH_MIN_COUNT.value] = 1
            }
            if (!attr.allowMultiple) {
                json[VOCAB.SH_MAX_COUNT.value] = 1
            }

            // keep the inverse map of properties
            const propDomain = propAcc[path] || [];
            propDomain.push(id)
            propAcc[path] = propDomain

            return json;
        });

        const associations = (entity.associations || [])
            .filter(a => a.target != null)
            .map(assoc => {
                const path = assoc.name
                let json: {[n: string]: any} = {
                    "path": path
                }
                const targetEntity = entityLinkingMap[assoc.target?.id()!]
                if (targetEntity != null) {
                    json[VOCAB.SH_NODE.value] = this.entityId(targetEntity)
                    if (assoc.required) {
                        json[VOCAB.SH_MIN_COUNT.value] = 1
                    }
                    if (!assoc.allowMultiple) {
                        json[VOCAB.SH_MAX_COUNT.value] = 1
                    }

                    // keep the inverse map of properties
                    const propDomain = propAcc[path] || [];
                    propDomain.push(id)
                    propAcc[path] = propDomain

                    return json;
                } else {
                    console.log(`Unlinked entity ${assoc.target?.id()} cannot export to CIM`)
                    return null;
                }
            })
            .filter(p => p != null);

        const properties = attributes.concat(associations);

        if (entity.extends != null) {
            const superShape = {
                "@id": this.toId(entity.extends?.name)
            }
            // @ts-ignore
            json['and'] = [
                superShape,
                {
                    "properties": properties
                }
            ]
            return json;
        } else {
            // @ts-ignore
            json['properties'] = properties;
            return json
        }
    }

    private exportEntityClass(entity: Entity) {
        let id = this.toId(entity.name); // @todo we need a binding for this
        if (entity.uuid.indexOf("cim/entity/") > -1) {
            id = entity.uuid.split("cim/entity/").pop()!;
        }
        let json = {
            "@id": id,
            "name": entity.name,
            "@type": "Class"
        };

        if (entity.extends != null) {
            // @ts-ignore
            json['subClassOf'] = this.toId(entity.extends.name);
        }
        if (entity.description != null) {
            // @ts-ignore
            json['description'] = entity.description!;
        }

        return json;

    }

    protected toId(name: string) {
        return name.replace(/\s+/, "").replace("_", "")
    }
}