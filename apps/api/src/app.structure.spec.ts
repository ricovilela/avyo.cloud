import 'reflect-metadata';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AppModule } from './app.module';
import { ConfigModule } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { AviaryModule } from './modules/aviary/aviary.module';
import { BandModule } from './modules/band/band.module';
import { BandColorModule } from './modules/band-color/band-color.module';
import { BirdModule } from './modules/bird/bird.module';
import { CageModule } from './modules/cage/cage.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ColorClassModule } from './modules/color-class/color-class.module';
import { GeneticsModule } from './modules/genetics/genetics.module';
import { ManagementModule } from './modules/management/management.module';
import { OfficialColorModule } from './modules/official-color/official-color.module';
import { SpeciesModule } from './modules/species/species.module';
import { StatusModule } from './modules/status/status.module';

/**
 * Structure / boot smoke tests for the API skeleton.
 *
 * Validates: Requirements 7.3, 7.6
 *
 * These are example / smoke tests (this spec is scaffolding-only). They assert
 * the on-disk `src/common/` and `src/modules/` layout matches the locked
 * convention, and that `AppModule` registers the config module plus all 13 MVP
 * module classes.
 */

const SRC_DIR = __dirname;

/** The subdirectories required under `src/common/` (Req 7.3). */
const EXPECTED_COMMON_SUBDIRS = [
  'decorators',
  'filters',
  'guards',
  'interceptors',
  'pagination',
  'prisma',
].sort();

/** The exactly-13 MVP module folders required under `src/modules/` (Req 7.6). */
const EXPECTED_MODULE_FOLDERS = [
  'auth',
  'aviary',
  'band',
  'band-color',
  'bird',
  'cage',
  'calendar',
  'color-class',
  'genetics',
  'management',
  'official-color',
  'species',
  'status',
].sort();

/** The 13 module classes that `AppModule` must import (Req 7.6). */
const EXPECTED_MODULE_CLASSES = [
  AuthModule,
  BirdModule,
  GeneticsModule,
  CalendarModule,
  BandModule,
  BandColorModule,
  CageModule,
  SpeciesModule,
  OfficialColorModule,
  ColorClassModule,
  StatusModule,
  ManagementModule,
  AviaryModule,
];

function directoriesIn(path: string): string[] {
  return readdirSync(path)
    .filter((entry) => statSync(join(path, entry)).isDirectory())
    .sort();
}

describe('src/common/ structure (Req 7.3)', () => {
  const commonDir = join(SRC_DIR, 'common');

  it('contains exactly the expected subdirectories', () => {
    expect(directoriesIn(commonDir)).toEqual(EXPECTED_COMMON_SUBDIRS);
  });
});

describe('src/modules/ structure (Req 7.6)', () => {
  const modulesDir = join(SRC_DIR, 'modules');

  it('contains exactly the 13 expected MVP module folders', () => {
    expect(directoriesIn(modulesDir)).toEqual(EXPECTED_MODULE_FOLDERS);
  });

  it.each(EXPECTED_MODULE_FOLDERS)(
    'module folder "%s" contains a *.module.ts file',
    (folder) => {
      const folderPath = join(modulesDir, folder);
      const moduleFiles = readdirSync(folderPath).filter((entry) =>
        entry.endsWith('.module.ts'),
      );

      expect(moduleFiles.length).toBeGreaterThanOrEqual(1);
      // The conventional file name matches the folder (e.g. band-color.module.ts).
      expect(existsSync(join(folderPath, `${folder}.module.ts`))).toBe(true);
    },
  );
});

describe('AppModule registration (Req 7.6)', () => {
  const imports = (Reflect.getMetadata('imports', AppModule) ??
    []) as unknown[];

  it('imports the ConfigModule', () => {
    expect(imports).toContain(ConfigModule);
  });

  it.each(EXPECTED_MODULE_CLASSES.map((cls) => [cls.name, cls] as const))(
    'imports %s',
    (_name, moduleClass) => {
      expect(imports).toContain(moduleClass);
    },
  );

  it('imports all 13 MVP module classes and the ConfigModule (14 total)', () => {
    for (const moduleClass of EXPECTED_MODULE_CLASSES) {
      expect(imports).toContain(moduleClass);
    }
    expect(imports).toContain(ConfigModule);
    expect(EXPECTED_MODULE_CLASSES).toHaveLength(13);
  });
});
