import type { DependencyFormat } from './document';
import { pbxproj } from './pbxproj';
import { xcproj } from './xcproj';

export const xcodeProject: DependencyFormat = {
  read(source, file) {
    if (file.endsWith('.pbxproj')) return pbxproj.read(source, file);
    if (file.endsWith('.xcproj')) return xcproj.read(source, file);
    throw new Error(`${file}: unsupported Xcode project format; expected .pbxproj or .xcproj`);
  },
};
