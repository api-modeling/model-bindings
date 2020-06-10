//import * as meta from "@api-modeling-tooling/api-modeling-metadata";
import { DialectWrapper } from "@api-modeling-tooling/api-modeling-metadata";

export abstract class BindingsPlugin  {
//    abstract async import(location: string): Promise<meta.DialectWrapper[]>
    abstract async import(location: string): Promise<DialectWrapper[]>
}