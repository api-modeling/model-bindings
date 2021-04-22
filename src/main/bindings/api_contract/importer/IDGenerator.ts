import * as amf from "@api-modeling/amf-client-js";
import {AMFModelQueries as $apiModel} from "./AMFModelQueries";

export class IDGenerator {
    private idGenerator = 0;
    // Resets the seed to generate identifiers
    protected resetAutoGen() {
        this.idGenerator = 0;
    }

    public getShapeName(shape: amf.model.domain.Shape, hint: string = "Entity") {
        const name = $apiModel.getShapeName(shape, hint)
        if (name) {
            return name;
        } else {
            return this.genName(hint);
        }
    }

    public genName(root: string) {
        this.idGenerator++;
        const name = `${root}${this.idGenerator}`;
        return name;
    }

}