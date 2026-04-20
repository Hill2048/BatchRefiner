import { TaskList } from '../workspace/TaskList';

export function Workspace() {
  return (
    <div className="flex-1 flex w-full relative overflow-hidden bg-background">
      <div className="flex-1 flex flex-col transition-all duration-300 w-full">
        <TaskList />
      </div>
    </div>
  );
}
