import * as meta from "@api-modeling/api-modeling-metadata";

export class APIModelQueries {

    public static isNodeShape(entity: meta.Entity): boolean {
        const fieldNum = (entity.attributes || []).length + (entity.associations || []).length
        return fieldNum > 0
    }

    public static isUnionShape(entity: meta.Entity): boolean {
        return (entity.disjoint || []).length > 0;
    }

}