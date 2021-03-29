import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from "@api-modeling/amf-client-js";
import {VOCAB} from "../api_contract/constants";

export abstract class ExporterBaseUtils {

    /**
     * Find values of an specified param in a collection of param values
     * @param values
     * @param parameterId
     */
    protected findParam(values: meta.BindingValue[], parameterId: string) {
        return values.filter((param) => {
            // @ts-ignore
            return param.parameter && param.parameter === parameterId;
        })
    }

    protected generateElementName(name: string|undefined, description: string|undefined, element: amf.model.domain.DomainElement) {
        if (name != null) {
            //@ts-ignore
            element.withName(name)
        }
        if (description != null) {
            //@ts-ignore
            element.withDescription(description)
        }
    }

    /**
     * Transforms a scalar range for an object into a AMF ScalarShape
     * @param subjectId
     * @param scalar
     */
    protected transformScalarRange(subjectId: string, scalar: meta.Scalar) {
        const scalarShape: amf.model.domain.ScalarShape = new amf.model.domain.ScalarShape();
        scalarShape.withId(subjectId + "_scalar");

        if (scalar instanceof meta.StringScalar) {
            scalarShape.withDataType(VOCAB.XSD_STRING)
        } else if (scalar instanceof  meta.IntegerScalar) {
            scalarShape.withDataType(VOCAB.XSD_INTEGER)
        } else if (scalar instanceof  meta.FloatScalar) {
            scalarShape.withDataType(VOCAB.XSD_FLOAT)
        } else if (scalar instanceof  meta.BooleanScalar) {
            scalarShape.withDataType(VOCAB.XSD_BOOLEAN)
        } else if (scalar instanceof  meta.DateTimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE_TIME)
        } else if (scalar instanceof  meta.DateScalar) {
            scalarShape.withDataType(VOCAB.XSD_DATE)
        } else if (scalar instanceof  meta.TimeScalar) {
            scalarShape.withDataType(VOCAB.XSD_TIME)
        } else {
            throw new Error(`Unsupported model scalar ${scalar}`)
        }

        return scalarShape;
    }

}