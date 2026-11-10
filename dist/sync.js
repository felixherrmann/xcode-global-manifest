"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.synchronize = synchronize;
const swift_1 = require("./formats/swift");
const snapshot_1 = require("./snapshot");
const reconcile_1 = require("./reconcile");
/** Read dependencies, reconcile both directions, then render only changed files. */
function synchronize({ base, head, sources, globalPath, swiftToolsVersion = swift_1.DEFAULT_SWIFT_TOOLS_VERSION }) {
    const before = (0, snapshot_1.readSnapshot)(base, sources, globalPath, true);
    const current = (0, snapshot_1.readSnapshot)(head, sources, globalPath);
    const plan = (0, reconcile_1.reconcile)(before, current, globalPath);
    const updates = updateSourceRequirements(current, head, plan.sourceUpdates);
    const currentToolsVersion = head[globalPath]?.match(/^\/\/ swift-tools-version:[ \t]*(\d+\.\d+(?:\.\d+)?)[ \t]*(?:\r?\n|$)/)?.[1];
    if (!current.global || !(0, reconcile_1.sameDependencies)(current.global, plan.dependencies) || currentToolsVersion !== swiftToolsVersion) {
        updates[globalPath] = (0, swift_1.generate)(plan.dependencies, swiftToolsVersion);
    }
    return updates;
}
function updateSourceRequirements(snapshot, files, requirements) {
    const updates = {};
    if (!requirements.size)
        return updates;
    for (const document of snapshot.documents) {
        const content = document.update(requirements);
        if (content !== files[document.file])
            updates[document.file] = content;
    }
    return updates;
}
