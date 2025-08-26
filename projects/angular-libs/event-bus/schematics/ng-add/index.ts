import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
} from '@angular-devkit/schematics';

export function ngAdd(): Rule {
  return (tree: Tree, context: SchematicContext) => {
    context.logger.info('Running ng-add for @angular-libs/event-bus');

    const project = getProject(tree);
    const projectPath = project.sourceRoot || 'src';

    // Create app-event-bus.service.ts
    const serviceContent = `import { Injectable } from '@angular/core';
import { EventBusService } from '@angular-libs/event-bus';
import { AppEventMap } from './event-bus.models';

@Injectable({ providedIn: 'root' })
export class AppEventBusService extends EventBusService<AppEventMap> {}
`;
    tree.create(
      `${projectPath}/app/event-bus/app-event-bus.service.ts`,
      serviceContent
    );

    // Create event-bus.models.ts
    const modelsContent = `export interface AppEventMap {
  'user:login': { userId: number, userName: string };
}
`;
    tree.create(
      `${projectPath}/app/event-bus/event-bus.models.ts`,
      modelsContent
    );

    return tree;
  };
}

function getProject(tree: Tree) {
  const angularJson = tree.read('angular.json');
  if (!angularJson) {
    throw new SchematicsException(
      'Could not find angular.json in the workspace.'
    );
  }

  const workspace = JSON.parse(angularJson.toString());
  const projects = workspace.projects || {};
  const defaultProject =
    workspace.defaultProject ||
    (workspace.extensions && workspace.extensions.defaultProject);

  // pick provided default or fall back to the first project key
  const projectName = defaultProject || Object.keys(projects)[0];
  if (!projectName) {
    throw new SchematicsException(
      'Could not determine an Angular project. Add a defaultProject to angular.json or pass --project.'
    );
  }

  const project = projects[projectName] || projects[Object.keys(projects)[0]];
  if (!project) {
    throw new SchematicsException(
      `Project "${projectName}" not found in angular.json.`
    );
  }

  return project;
}
