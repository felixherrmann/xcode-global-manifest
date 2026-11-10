"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const config_1 = require("./action/config");
const repository_1 = require("./action/repository");
const sync_1 = require("./sync");
function main() {
    const config = (0, config_1.readConfig)();
    const repository = (0, repository_1.openRepository)(config.root);
    const { base, head } = repository.readComparison(config);
    const updates = (0, sync_1.synchronize)({
        base,
        head,
        sources: config.sources,
        globalPath: config.globalPath,
        swiftToolsVersion: config.swiftToolsVersion,
    });
    const commitSHA = repository.commitAndPush(updates, config);
    const output = commitSHA ? `changed=true\ncommit-sha=${commitSHA}\n` : 'changed=false\n';
    node_fs_1.default.appendFileSync(config.outputPath, output);
}
try {
    main();
}
catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
