import {AMLBindingsPlugin} from "./bindings/AMLBindingsPlugin";
import fs from "fs";
import path from "path";

// Small utility to serialize CIM using the modeling tool schemas
const amlPlugin = new AMLBindingsPlugin();
const url = "src/test/resources/aml/modeling/schema/apiModelDialect.yaml"
const text = fs.readFileSync(url).toString()
amlPlugin.import([],[{url: "file://"+ url, text: text}]).then((parsed) => {
    const base = "out/aml-modeling-tool/";
    parsed.forEach((dialectInstance) => {
        const location = base + dialectInstance.location;
        const locationDir = path.dirname(location);
        if (!fs.existsSync(locationDir)) {
            fs.mkdirSync(locationDir, {recursive: true});
        }
        dialectInstance.toYaml().then((data) => {
            fs.writeFileSync(location + ".yaml", data);
        });
        dialectInstance.toJsonLd().then((data) => {
            fs.writeFileSync(location + ".jsonld", data);
        });
    });
});
