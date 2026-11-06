"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xcodeProject = void 0;
const pbxproj_1 = require("./pbxproj");
const xcproj_1 = require("./xcproj");
exports.xcodeProject = {
    read(source, file) {
        if (file.endsWith('.pbxproj'))
            return pbxproj_1.pbxproj.read(source, file);
        if (file.endsWith('.xcproj'))
            return xcproj_1.xcproj.read(source, file);
        throw new Error(`${file}: unsupported Xcode project format; expected .pbxproj or .xcproj`);
    },
};
