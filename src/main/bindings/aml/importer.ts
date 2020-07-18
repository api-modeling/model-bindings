import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Md5} from "ts-md5";
import {VOCAB} from "../api_contract/constants";

type Mapping = amf.model.domain.NodeMapping|amf.model.domain.UnionNodeMapping;

export class AMLImporter {

    private idGenerator = 0;
    // Resets the seed to generate identifiers
    protected resetAutoGen() {
        this.idGenerator = 0;
    }

    protected parseBaseUnit(moduleUri: string, baseUnit: amf.model.document.BaseUnit,  parsed: meta.DataModel[] = []): meta.DataModel[] {
        const name = baseUnit.location.split("/").reverse()[0];
        if (!parsed.find((dm) => dm.uuid === baseUnit.id)) {
            if (this.hasNodeMappings(baseUnit).length !== 0) {
                const entities = this.parseNodeMappings(baseUnit);
                const dataModel = new meta.DataModel(moduleUri);
                dataModel.uuid = Md5.hashStr(baseUnit.id).toString();
                dataModel.entities = entities;
                dataModel.name = name;
                dataModel.description = baseUnit.usage.option;
                // @ts-ignore
                dataModel['parsed'] = baseUnit;
                parsed.push(dataModel);
                baseUnit.references().map((ref) => {
                    this.parseBaseUnit(moduleUri, ref, parsed);
                })
            }
        }
        return parsed;
    }


    private hasNodeMappings(baseUnit: amf.model.document.BaseUnit): Mapping[] {
        let acc: Mapping[] = [];

        if (baseUnit instanceof amf.model.document.Dialect) {
            const dialect = (<amf.model.document.Dialect>baseUnit)
            const encoded = dialect.encodes
            if (encoded != null && (encoded instanceof amf.model.domain.NodeMapping || encoded instanceof amf.model.domain.UnionNodeMapping)) {
                acc.push(encoded)
            }
            const declared = dialect.declares || [];
            if (declared != null) {
                declared.forEach((dec) => {
                    if (dec instanceof amf.model.domain.NodeMapping || dec instanceof amf.model.domain.UnionNodeMapping) {
                        acc = acc.concat(dec)
                    }
                });
            }
        }

        if (baseUnit instanceof amf.model.document.DialectLibrary) {
            const dialect = (<amf.model.document.DialectLibrary>baseUnit)
            const declared = dialect.declares || [];
            if (declared != null) {
                declared.forEach((dec) => {
                    if (dec instanceof amf.model.domain.NodeMapping || dec instanceof amf.model.domain.UnionNodeMapping) {
                        acc = acc.concat(dec)
                    }
                });
            }
        }
        return acc;
    }

    private parseNodeMappings(baseUnit: amf.model.document.BaseUnit): meta.Entity[] {
        let entities: meta.Entity[] = [];
        let nodeMappings = this.hasNodeMappings(baseUnit);
        nodeMappings.forEach((nm) =>
            entities.push(this.parseMapping(nm, entities, true))
        );
        return entities;
    }

    private parseMapping(mapping: Mapping, entities: meta.Entity[], topLevel: boolean = false): meta.Entity {
        const uuid = Md5.hashStr(mapping.id).toString();
        const alreadyParsed = entities.find((e) => e.uuid === uuid);
        if (alreadyParsed != null) {
            return alreadyParsed;
        } else {
            if (mapping.isLink) {
                const linkTarget = mapping.linkTarget!.id;
                const linkName = mapping.linkLabel!.value()
                const link = new meta.Entity(linkName);
                link.uuid = Md5.hashStr(linkTarget).toString();
                // @ts-ignore
                link['isLink'] = true;
                return link;
            } else {
                if (mapping instanceof amf.model.domain.NodeMapping) {
                    return this.parseNodeMapping(mapping, entities, topLevel);
                } else {
                    return this.parseUnionNodeMapping(<amf.model.domain.UnionNodeMapping>mapping, entities, topLevel);
                }
            }
        }
    }
    private parseNodeMapping(nodeMapping: amf.model.domain.NodeMapping, entities: meta.Entity[], topLevel: boolean = false): meta.Entity {
        const name = this.getMappingName(nodeMapping)
        const entity = new meta.Entity(name)
        entity.uuid = Md5.hashStr(nodeMapping.id).toString();
        // @todo from vocabulary
        // entity.description =

        // Process extensions using the base shapes in the model
        if (nodeMapping.extendsNode.length !== 0) {
            const extensions = nodeMapping.extendsNode.map((baseShape) => {
                if (baseShape instanceof amf.model.domain.NodeMapping || baseShape instanceof amf.model.domain.UnionNodeMapping) {
                    const extendedFrom = this.parseMapping(baseShape, entities);
                    if (extendedFrom != null) {
                        return this.genEntityLink(extendedFrom!.id());
                    } else {
                        return null;
                    }
                }
            }).filter((uuid) => uuid != null);
            if (extensions.length > 1) {
                // @todo
                throw new Error("More than one base shape not supported in entity dialect yet")
            }
            if (extensions.length === 1) {
                entity.extends = extensions[0]!
            }
        }

        // Let's classify properties in scalar that will become attributes and objects that will become associations
        // If we find a type of shape we don't support we will throw an error.
        let scalarProperties: (amf.model.domain.PropertyMapping)[] = []
        let objectProperties: (amf.model.domain.PropertyMapping)[] = []

        nodeMapping.propertiesMapping().forEach((property) => {
            const classif = property.classification()
            if (classif.indexOf("object") > -1) {
                objectProperties.push(property)
            } else if (classif.indexOf("literal") > -1) {
                scalarProperties.push(property)
            }
        });
        
        entity.attributes = scalarProperties.map((property) => {
            return this.parseAttribute(property);
        });
        
        entity.associations = objectProperties.map((property) => {
            return this.parseAssociation(property)
        });

        return entity;
    }
    
    

    private parseUnionNodeMapping(union: amf.model.domain.UnionNodeMapping, entities: meta.Entity[], topLevel: boolean): meta.Entity {
        const name = this.getMappingName(union)
        const entity = new meta.Entity(name)
        const unionMembers = union.objectRange().map((idField) => this.genEntityLink(idField.value()))
        entity.disjoint = unionMembers
        return entity;
    }

    //@todo: move to commong
    /**
     * Checks that a shape can be transformed into a modeling Scalar value
     * @param shape
     */
    private getMappingName(shape: Mapping, hint: string = "Entity"): string {
        const name = shape.name.option ;
        if (name != null && name !== "type") {
            return name;
        } else {
            return this.genName(hint);
        }
    }

    private genName(root: string) {
        this.idGenerator++;
        return `${root}${this.idGenerator}`;
    }

    private parseAttribute(property: amf.model.domain.PropertyMapping) {
        let scalarRange;
        let literalRange = property.literalRange().value()

        if (literalRange === VOCAB.XSD_STRING) {
            scalarRange = new meta.StringScalar();
        } else if (literalRange === VOCAB.XSD_INTEGER) {
            scalarRange = new meta.IntegerScalar();
        } else if (literalRange === VOCAB.XSD_FLOAT) {
            scalarRange = new meta.FloatScalar();
        } else if (literalRange === VOCAB.XSD_BOOLEAN) {
            scalarRange = new meta.BooleanScalar();
        } else if (literalRange === VOCAB.XSD_DATE_TIME) { // @todo format option
            scalarRange = new meta.DateTimeScalar();
        } else if (literalRange === VOCAB.XSD_DATE) {
            scalarRange = new meta.DateScalar();
        } else if (literalRange === VOCAB.AML_DATE_TIME_ONLY) { // @todo format option
            scalarRange = new meta.DateTimeScalar()
        } else if (literalRange === VOCAB.XSD_TIME) {
            scalarRange = new meta.TimeScalar();
        } else if (literalRange === VOCAB.AML_NUMBER) {
            scalarRange = new meta.FloatScalar();
        } else if (literalRange === VOCAB.XSD_DOUBLE) { // @todo add type binding
            scalarRange = new meta.FloatScalar();
        } else if (literalRange === VOCAB.XSD_LONG) { // @todo add type binding
            scalarRange = new meta.IntegerScalar();
        } else if (literalRange === VOCAB.AML_DATE_TIME_ONLY) {
            scalarRange = new meta.DateTimeScalar();
        } else if (literalRange === VOCAB.AML_NUMBER) {
            scalarRange = new meta.FloatScalar();
        } else if (literalRange === VOCAB.AML_LINK) { // @todo check links here
            scalarRange = new meta.StringScalar();
            // throw new Error("AML Links not supported")
        } else if (literalRange === VOCAB.AML_ANY) {
            throw new Error("AML Any not supported") // @todo check any here
        } else if (literalRange === VOCAB.XSD_URI) {
            scalarRange = new meta.StringScalar();
        } else {
            throw new Error(`Unsupported scalar value ${literalRange}`) // @todo missing null, link, uri
        }

        // now we can create the attribute wrapper
        const name = property.name().value()
        const attribute = new meta.Attribute(name, scalarRange)
        attribute.uuid = Md5.hashStr(property.id).toString();
        //attribute.description = property.description.option;
        attribute.required = (property.minCount().option || 0) !== 0;
        attribute.allowMultiple = property.allowMultiple().option || false;

        // @todo parse additional attributes for a property shape and add bindings
        return attribute;
    }

    private parseAssociation(property: amf.model.domain.PropertyMapping): meta.Association {
        if (property.objectRange().length === 1) {
            // now we can create the association wrapper
            const name = property.name().value();
            const association = new meta.Association(name);
            association.uuid = Md5.hashStr(property.id).toString();
            // association.description = property.description.option; @todo: from vocab
            association.required = (property.minCount().option || 0) !== 0;
            association.allowMultiple = property.allowMultiple().option || false
            association.target = this.genEntityLink(property.objectRange()[0]!.value());

            return association;
        } else {
            const name = "Union "+ this.idGenerator;
            this.idGenerator++;
            const entity = new meta.Entity(name)
            const unionMembers = property.objectRange().map((idField) => this.genEntityLink(idField.value()))
            entity.disjoint = unionMembers
            return entity;
        }
    }

    private genEntityLink(id: string): string {
        const uuid = Md5.hashStr(id).toString()
        const entity = new meta.Entity("")
        entity.uuid = uuid;
        return entity.id();
    }
}