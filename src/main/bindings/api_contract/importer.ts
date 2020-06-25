import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {Md5} from 'ts-md5/dist/md5';
import {VOCAB} from "./constants";

export class APIContractImporter {

    private idGenerator = 0;
    // Resets the seed to generate identifiers
    protected resetAutoGen() {
        this.idGenerator = 0;
    }

    /**
     * Generates base unit bindings for the parsed BaseUnits in the API AMF model
     * @param baseUnit
     * @param dataModel
     */
    protected parseBaseUnitBindings(baseUnit: amf.model.document.BaseUnit, dataModel: meta.DataModel): meta.Binding {
        const binding = new meta.Binding(dataModel.id(), VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING);
        const param = new meta.BindingScalarValue();
        param.parameter = VOCAB.API_CONTRACT_DOCUMENT_TYPE_BINDING_PARAMETER
        param.uuid = binding.uuid + "param";
        binding.uuid = `apiContract/bindings/DocumentTypeBinding/${dataModel.uuid}`

        if (baseUnit instanceof amf.model.document.Document) {
            param.lexicalValue = "Open API Spec / RAML API Spec"
            binding.configuration = [param]
        } else if (baseUnit instanceof amf.model.document.Fragment) {
            param.lexicalValue = "JSON Schema / RAML Fragment"
            binding.configuration = [param]
        } else if (baseUnit instanceof amf.model.document.Module) {
            param.lexicalValue = "JSON Schema / RAML Library"
            binding.configuration = [param]
        }
        binding.configuration = [param]
        return binding;
    }

    /**
     * Parses an AMF BaseUnit and generates one or more modules with associated data models for the modeling tool
     * @param baseUnit
     */
    protected parseBaseUnit(moduleUri: string, baseUnit: amf.model.document.BaseUnit, parsed: meta.DataModel[] = []): meta.DataModel[] {
        const name = baseUnit.location.split("/").reverse()[0];

        if (!parsed.find((dm) => dm.uuid === baseUnit.id)) {
            const entities = this.parseShapes(baseUnit);
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
        return parsed;
    }

    /**
     * Parses all the shapes in an AMF BaseUnit as modeling entities
     * @param module
     * @param baseUnit
     */
    private parseShapes(baseUnit: amf.model.document.BaseUnit): meta.Entity[] {
        let entities: meta.Entity[] = [];
        if (baseUnit instanceof amf.model.document.Module || baseUnit instanceof amf.model.document.Document) {
            const declarations = <amf.model.document.DeclaresModel>baseUnit;
            (declarations.declares || []).forEach((domainElement) => this.parseShape(domainElement, entities, true))
        }

        if (baseUnit instanceof amf.model.domain.DataType) {
            const encoded = <amf.model.document.EncodesModel>baseUnit;
            this.parseShape(encoded.encodes, entities, true)
        }
        return entities
    }

    private parseShape(domainElement: amf.model.domain.DomainElement, entities: meta.Entity[], topLevel = false): meta.Entity|null {
        const uuid = Md5.hashStr(domainElement.id).toString();
        const alreadyParsed = entities.find((e) => e.uuid === uuid);

        if (alreadyParsed != null) {
            return alreadyParsed;
        } else {
            if (this.isLink(domainElement)) {
                const linkTarget = (<amf.model.domain.AnyShape>domainElement).linkTarget!.id;
                const linkName = (<amf.model.domain.AnyShape>domainElement).linkLabel!.value()
                const link = new meta.Entity(linkName);
                link.uuid = Md5.hashStr(linkTarget).toString();;
                // @ts-ignore
                link['isLink'] = true;
                return link;
            } else {
                let parsed: meta.Entity|null = null;
                if (domainElement instanceof amf.model.domain.NodeShape) {
                    parsed = this.parseNodeShape(<amf.model.domain.NodeShape>domainElement, entities);
                } else if (domainElement instanceof amf.model.domain.AnyShape) {
                    parsed = this.parseAnyShape(<amf.model.domain.AnyShape>domainElement, entities);
                }
                if (parsed != null && topLevel) {
                    entities.push(this.uniqueName(parsed, entities))
                }
                return parsed;
            }
        }
        return null;
    }

    /**
     * Parses a generic AnyShape
     * @param domainElement1
     * @param entities
     */
    private parseAnyShape(anyShape: amf.model.domain.AnyShape, entities: meta.Entity[]) {
        const name = this.getShapeName(anyShape)
        const entity = new meta.Entity(name)
        entity.uuid = Md5.hashStr(anyShape.id).toString();
        entity.displayName = anyShape.displayName.option
        entity.description = anyShape.description.option
        return entity;
    }

    /**
     * Parses an individual object shape and generates a modeling entity out of it
     * @param nodeShape
     */
    private parseNodeShape(nodeShape: amf.model.domain.NodeShape, entities: meta.Entity[]): meta.Entity|null {
        const name = this.getShapeName(nodeShape)
        const entity = new meta.Entity(name)
        entity.uuid = Md5.hashStr(nodeShape.id).toString();
        entity.displayName = nodeShape.displayName.option
        entity.description = nodeShape.description.option

        // Process extensions using the base shapes in the model
        if (nodeShape.inherits.length !== 0) {
            const extensions = nodeShape.inherits.map((baseShape) => {
                const extendedFrom = this.parseShape(baseShape, entities);
                if (extendedFrom != null) {
                    return extendedFrom!.id()
                } else {
                    return null;
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
        let scalarProperties: (amf.model.domain.PropertyShape)[] = []
        let objectProperties: (amf.model.domain.PropertyShape)[] = []

        nodeShape.properties.forEach((property) => {
            if (this.isScalarShape(property.range)) {
                scalarProperties.push(property)
            } else if (this.isObjectShape(property.range)) {
                objectProperties.push(property)
            } else if (property.range instanceof amf.model.domain.ArrayShape) {
                let arrayShape = <amf.model.domain.ArrayShape>property.range;
                if (this.isScalarShape(arrayShape.items)) {
                    scalarProperties.push(property)
                } else if (this.isObjectShape(arrayShape.items)) {
                    objectProperties.push(property)
                } else {
                    // @todo
                    throw new Error(`Unsupported property range array items shape ${arrayShape.items}`);
                }
            } else {
                // @todo
                throw new Error(`Unsupported property range shape ${property.range}`);
            }
        });

        entity.attributes = scalarProperties.map((property) => {
            return this.parseAttribute(property);
        });

        entity.associations = objectProperties.map((property) => {
            return this.parseAssociation(property, entities);
        });

        return entity;
    }

    private isScalarShape(shape: amf.model.domain.Shape): boolean {
        if (shape instanceof amf.model.domain.ScalarShape) {
            return true;
        }
        return false;
    }

    /**
     * Checks that a shape can be transformed into an modeling Entity
     * @param shape
     */
    private isObjectShape(shape: amf.model.domain.Shape): boolean {
        if (shape instanceof amf.model.domain.NodeShape) {
            return true;
        }
        if (shape instanceof amf.model.domain.AnyShape) {
            return true;
        }
        return false;
    }

    /**
     * Checks that a shape can be transformed into a modeling Scalar value
     * @param shape
     */
    private getShapeName(shape: amf.model.domain.Shape, hint: string = "Entity"): string {
        const name = shape.displayName.option || shape.name.option ;
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

    private parseAttribute(property: amf.model.domain.PropertyShape): meta.Attribute {
        // lets get the final shape
        let shape = property.range;
        if (shape instanceof amf.model.domain.ArrayShape) {
            shape = (<amf.model.domain.ArrayShape>shape).items
        }
        let scalarShape = <amf.model.domain.ScalarShape>shape;

        // let's compute the range
        let scalarRange: meta.Scalar;
        if (scalarShape.dataType.value() === VOCAB.XSD_STRING) {
            scalarRange = new meta.StringScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_INTEGER) {
            scalarRange = new meta.IntegerScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_FLOAT) {
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_BOOLEAN) {
            scalarRange = new meta.BooleanScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DATE_TIME) { // @todo format option
            scalarRange = new meta.DateTimeScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DATE) {
            scalarRange = new meta.DateScalar();
        } else if (scalarShape.dataType.value() === VOCAB.AML_DATE_TIME_ONLY) { // @todo format option
            scalarRange = new meta.DateTimeScalar()
        } else if (scalarShape.dataType.value() === VOCAB.XSD_TIME) {
            scalarRange = new meta.TimeScalar();
        } else if (scalarShape.dataType.value() === VOCAB.AML_NUMBER) {
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_DOUBLE) { // @todo add type binding
            scalarRange = new meta.FloatScalar();
        } else if (scalarShape.dataType.value() === VOCAB.XSD_LONG) { // @todo add type binding
            scalarRange = new meta.IntegerScalar();
        } else {
            throw new Error(`Unsupported scalar value ${scalarShape.dataType.value()}`) // @todo missing null, link, uri
        }

        // now we can create the attribute wrapper
        const name = this.getShapeName(property, "attribute")
        const attribute = new meta.Attribute(name, scalarRange)
        attribute.uuid = Md5.hashStr(property.id).toString();
        attribute.description = property.description.option;
        attribute.required = (property.minCount.option || 0) !== 0;
        attribute.allowMultiple = property.range instanceof amf.model.domain.ArrayShape;

        // @todo parse additional attributes for a property shape and add bindings
        return attribute;
    }

    private parseAssociation(property: amf.model.domain.PropertyShape, entities: meta.Entity[]): meta.Association {
        // lets get the final shape
        let shape = property.range;
        if (shape instanceof amf.model.domain.ArrayShape) {
            shape = (<amf.model.domain.ArrayShape>shape).items
        }

        let range = this.parseShape(shape, entities)

        if (range != null) {
            // now we can create the association wrapper
            const name = this.getShapeName(property, "association")
            const association = new meta.Association(name)
            association.uuid = Md5.hashStr(property.id).toString();
            association.description = property.description.option;
            association.required = (property.minCount.option || 0) !== 0;
            association.allowMultiple = property.range instanceof amf.model.domain.ArrayShape;
            association.target = this.associationLink(shape);
            // @todo parse additional attributes for a property shape and add bindings

            return association;
        } else {
            throw new Error(`Cannot create association with an empty target ${property.id}`)
        }
    }

    private isLink(domainElement: amf.model.domain.DomainElement) {
        if (domainElement instanceof amf.model.domain.AnyShape) {
            const anyShape = <amf.model.domain.AnyShape>domainElement;
            return anyShape.isLink;
        } else {
            return false;
        }
    }

    private associationLink(shape: amf.model.domain.Shape) {
        let id = shape.id;
        if (shape.isLink) {
            id = shape.linkTarget!.id;
        }
        const entity = new meta.Entity("")
        entity.uuid = Md5.hashStr(id).toString();
        return entity.id();
    }

    private uniqueName(parsed: meta.Entity, entities: meta.Entity[]) {
        const names: {[name: string]: boolean} = {}
        entities.forEach((e) => names[e.name] = true)
        let c = 0;
        let name = parsed.name
        while (names[name]) {
            c++
            name = `${parsed.name}${c}`
        }
        parsed.name = name
        if (parsed.displayName != null && c > 0) {
            parsed.displayName = `${parsed.displayName}${c}`
        }
        names[parsed.name] = true;

        return parsed;
    }

}