import * as n3 from "n3";
import {$rdf} from "../utils/N3Graph";

class CIMConstantsSingleton {
    // namespaces
    CIM_NS: string = "http://cloudinformationmodel.org/model/";
    RDF_NS: string = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
    SH_NS = "http://www.w3.org/ns/shacl#";
    XSD_NS = "http://www.w3.org/2001/XMLSchema#";

    // CIM model
    CIM_SUBJECT_AREA =  $rdf.namedNode(this.CIM_NS + 'SubjectArea');
    CIM_ENTITTY_GROUPS = $rdf.namedNode(this.CIM_NS + 'entityGroup');
    CIM_CLASSES = $rdf.namedNode(this.CIM_NS + 'classes');
    CIM_ID = $rdf.namedNode(this.CIM_NS + "id");
    RDF_TYPE = $rdf.namedNode(this.RDF_NS + "type");
    RDF_FIRST = $rdf.namedNode(this.RDF_NS + "first");
    RDF_REST = $rdf.namedNode(this.RDF_NS + "rest");
    RDFS_LABEL = $rdf.namedNode(this.RDFS_NS + "label");
    RDFS_COMMENT = $rdf.namedNode(this.RDFS_NS + "comment");
    SH_PROPERTY = $rdf.namedNode(this.SH_NS + "property");
    SH_PATH = $rdf.namedNode(this.SH_NS + "path");
    SH_DATATYPE = $rdf.namedNode(this.SH_NS + "datatype");
    SH_NODE = $rdf.namedNode(this.SH_NS + "node");
    SH_MAX_COUNT = $rdf.namedNode(this.SH_NS + "maxCount");
    SH_MIN_COUNT = $rdf.namedNode(this.SH_NS + "minCount");
    SH_AND = $rdf.namedNode(this.SH_NS + "and");

    // CIM Bindings
    CIM_BINDINGS_PROFILE = "http://mulesoft.com/modeling/instances/bindings/cim";
    CIM_BINDINGS_SUBJECT_AREA = "http://mulesoft.com/modeling/instances/bindings/cim/SubjectAreaBinding";
    CIM_BINDINGS_ENTITY_GROUP = "http://mulesoft.com/modeling/instances/bindings/cim/EntityGroupBinding";
}

export const VOCAB = new CIMConstantsSingleton();