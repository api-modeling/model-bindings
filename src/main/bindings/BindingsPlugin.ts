import * as meta from "api-modeling-metadata";

export abstract class BindingsPlugin  {
    abstract async import(location: string): Promise<meta.DialectWrapper[]>
}