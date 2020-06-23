

    class ApiConstractConstantsSingleton {
        // namespaces
        XSD_NS: string = "http://www.w3.org/2001/XMLSchema#";
        SHAPES_NS: string = "http://a.ml/vocabularies/shapes#";
        META_NS: string = "http://a.ml/vocabularies/meta#";

        XSD_INTEGER = this.XSD_NS + "integer"
        XSD_STRING = this.XSD_NS + "string"
        XSD_FLOAT = this.XSD_NS + "float"
        XSD_LONG = this.XSD_NS + "long"
        AML_NUMBER = this.SHAPES_NS + "number"
        AML_LINK   = this.SHAPES_NS + "link"
        XSD_DOUBLE = this.XSD_NS + "double"
        XSD_BOOLEAN= this.XSD_NS + "boolean"
        XSD_NIL    = this.XSD_NS + "nil"
        XSD_URI    = this.XSD_NS + "anyURI"
        XSD_ANY= this.XSD_NS + "anyType"
        AML_ANY = this.META_NS + "anyNode"
        XSD_DATE = this.XSD_NS + "date";
        XSD_DATE_TIME = this.XSD_NS + "dateTime"
        AML_DATE_TIME_ONLY = this.SHAPES_NS + "dateTimeOnly"
        XSD_TIME = this.XSD_NS + "time"

        // URIS
        API_CONTRACT_BINDINGS_PROFILE = "http://mulesoft.com/modeling/instances/bindings/api_contract";
        API_CONTRACT_DOCUMENT_TYPE_BINDING = "http://mulesoft.com/modeling/instances/bindings/apiContract/DocumentTypeBinding";
        API_CONTRACT_DOCUMENT_TYPE_BINDING_PARAMETER = "http://mulesoft.com/modeling/instances/uuid/api-contract-bindings-document-type-param"
    }

export const VOCAB = new ApiConstractConstantsSingleton();