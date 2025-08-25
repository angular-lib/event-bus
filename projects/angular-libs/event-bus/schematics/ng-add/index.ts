import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';

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
  'example:event': { message: string };
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
  const workspaceContent = tree.read('angular.json')!.toString();
  const workspace = JSON.parse(workspaceContent);
  const projectName = workspace.defaultProject;
  return workspace.projects[projectName];
}
