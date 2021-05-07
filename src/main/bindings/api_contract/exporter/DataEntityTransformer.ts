import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {ExportContext} from "./ExportContext";
import {ExporterBaseUtils} from "../../utils/ExporterBaseUtils";
import {APIModelQueries as $apiModel} from "./APIModelQueries";

export class DataEntityTransformer extends ExporterBaseUtils{
    private entity: meta.Entity;
    private context: ExportContext;
    private effectiveEntity: meta.Entity;

    constructor(entity: meta.Entity, context: ExportContext) {
        super();
        this.entity = entity;
        this.context = context;
        this.effectiveEntity = this.context.effectiveEntity(this.entity);
    }

    public transform(): amf.model.domain.AnyShape {
        if ($apiModel.isNodeShape(this.effectiveEntity)) {
            return this.transformObjectEntity(this.entity);
        } else if ($apiModel.isUnionShape(this.entity)) {
            return this.transformUnionEntity(this.entity);
        } else { // must be AnyShape
            return this.transformAnyEntity(this.entity);
        }
    }

    private transformObjectEntity(entity: meta.Entity): amf.model.domain.NodeShape {
        if (entity.adapts != null) { // @todo: merge both somehow
            entity = entity.adapts
        }

        let nodeShape = new amf.model.domain.NodeShape();
        nodeShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        nodeShape.withName(entity.name);
        if (entity.displayName != null) {
            nodeShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            nodeShape.withDescription(entity.description);
        }

        const scalarPropertyShapes: amf.model.domain.PropertyShape[] = (entity.attributes||[]).map((attribute) => {
            return this.transformAttribute(attribute);
        });

        const objectPropertyShapes: amf.model.domain.PropertyShape[] = (entity.associations || []).map((assoc) => {
            return this.exportAssociation(entity, assoc);
        });

        nodeShape.withProperties(scalarPropertyShapes.concat(objectPropertyShapes));

        if (entity.extends != null) {
            const baseLinks = entity.extends.map((e) => this.context.generateLink(entity.id(), e.id(), null)).filter((l) => l != null);
            if (baseLinks.length > 0) {
                nodeShape.withInherits(baseLinks);
            }
        }

        return nodeShape;
    }

    private exportAssociation(entity: meta.Entity, assoc: meta.Association): amf.model.domain.PropertyShape {
        const target = assoc.target;
        if (target != null) {
            const targetShape = this.context.generateLink(entity.id(), target!.id(), null);

            // The actual property shape
            const propertyShape: amf.model.domain.PropertyShape = new amf.model.domain.PropertyShape();
            propertyShape.withId(assoc.id())
            propertyShape.withName(assoc.name)
            if (assoc.displayName) {
                propertyShape.withDisplayName(assoc.displayName)
            }
            if (assoc.description) {
                propertyShape.withDescription(assoc.description)
            }

            // required
            if (assoc.required) {
                propertyShape.withMinCount(1);
            }
            // wrap in an array if the cardinality is N
            if (assoc.allowMultiple === true) {
                const arrayShape = new amf.model.domain.ArrayShape();
                arrayShape.withId(assoc.id() + "_array");
                arrayShape.withItems(targetShape);
                propertyShape.withRange(arrayShape);
            } else {
                propertyShape.withRange(targetShape);
            }

            return propertyShape
        } else {
            throw new Error(`Cannot parse an association without target entity: ${assoc.id()}`)
        }
    }


    private transformUnionEntity(entity: meta.Entity): amf.model.domain.UnionShape {
        const unionShape = new amf.model.domain.UnionShape();
        unionShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        unionShape.withName(entity.name);
        if (entity.displayName != null) {
            unionShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            unionShape.withDescription(entity.description);
        }

        const members = (entity.disjoint || []).map((unionEntity) => this.context.generateLink(entity.id(), unionEntity.id(), null));
        unionShape.withAnyOf(members);

        return unionShape;
    }

    private transformAnyEntity(entity: meta.Entity): amf.model.domain.AnyShape {
        const anyShape = new amf.model.domain.AnyShape();
        anyShape.withId(entity.id()); // @todo: add binding to store the original shape ID
        anyShape.withName(entity.name);
        if (entity.displayName != null) {
            anyShape.withDisplayName(entity.displayName);
        }
        if (entity.description != null) {
            anyShape.withDescription(entity.description);
        }

        if (entity.extends != null && entity.extends.length > 0) {
            const baseLinks = entity.extends.map((e) => this.context.generateLink(entity.id(), e.id(), null)).filter((l) => l != null);
            if (baseLinks.length > 0) {
                anyShape.withInherits(baseLinks);
            }
        }

        return anyShape;
    }

    /**
     * Transforms the attribute into a property shape with a scalar or
     * scalar array range.
     * @param attribute
     */
    private transformAttribute(attribute: meta.Attribute): amf.model.domain.PropertyShape {
        const scalarShape = this.transformScalarRange(attribute.id(), attribute.range!);
        // The actual property shape
        const propertyShape: amf.model.domain.PropertyShape = new amf.model.domain.PropertyShape();
        propertyShape.withName(attribute.name)
        if (attribute.displayName) {
            propertyShape.withDisplayName(attribute.displayName)
        }
        if (attribute.description) {
            propertyShape.withDescription(attribute.description)
        }
        propertyShape.withId(attribute.id())

        // required
        if (attribute.required) {
            propertyShape.withMinCount(1);
        }
        // wrap in an array if the cardinality is N
        if (attribute.allowMultiple === true) {
            const arrayShape = new amf.model.domain.ArrayShape();
            arrayShape.withId(attribute.id() + "_array");
            arrayShape.withItems(scalarShape);
            propertyShape.withRange(arrayShape);
        } else {
            propertyShape.withRange(scalarShape);
        }

        return propertyShape
    }
}