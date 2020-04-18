import {CIMBindingsPlugin} from "./bindings/CIMBindingsPlugin";
import fs from "fs";

// Small utility to serialize CIM using the modeling tool schemas
const cimPlugin = new CIMBindingsPlugin();
cimPlugin.import("file://../../src/test/resources/model.jsonld").then((parsed) => {
    const base = "../../out/cim/";
    parsed.forEach((dialectInstance) => {
        const location = base + dialectInstance.location;
        console.log(location);
        dialectInstance.toYaml().then((data) => {
            fs.writeFileSync(location + ".yaml", data);
        });
        dialectInstance.toJsonLd().then((data) => {
            fs.writeFileSync(location + ".jsonld", data);
        });
    });
});
