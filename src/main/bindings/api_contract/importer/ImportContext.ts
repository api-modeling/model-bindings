import {IDGenerator} from "./IDGenerator";

export class ImportContext {
    public readonly entityMap: {[id: string]: string} = {}
    public readonly idGenerator: IDGenerator = new IDGenerator();

    private unitsCache: Set<string>= new Set<string>();

    public registerParsedUnit(id: string) {
        this.unitsCache.add(id);
    }

    public alreadyParsedUnit(id: string) {
        return this.unitsCache.has(id);
    }
}