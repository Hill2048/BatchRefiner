import { toast } from "sonner";
import { useAppStore } from "@/store";
import { buildProjectExportPayload } from "@/lib/projectSnapshot";
import { markProjectFileSaved } from "@/lib/projectSafetyStatus";
import {
  clearProjectFileHandle,
  ensureProjectFilePermission,
  getProjectFileHandle,
  pickProjectSaveFile,
  supportsProjectFileSave,
  writeProjectFile,
} from "@/lib/projectFileSave";

export async function exportCurrentProjectFile() {
  const state = useAppStore.getState();
  const payload = buildProjectExportPayload(state);
  const data = JSON.stringify(payload, null, 2);
  const filename = `Project_${state.projectName}.json`;
  const successfulPromptCount = payload.successfulPrompts.length;

  if (supportsProjectFileSave()) {
    try {
      let handle = await getProjectFileHandle(state.projectId);
      let reusedExistingFile = true;

      if (!handle) {
        handle = await pickProjectSaveFile(state.projectId, filename);
        reusedExistingFile = false;
      } else {
        const hasPermission = await ensureProjectFilePermission(handle);
        if (!hasPermission) {
          await clearProjectFileHandle(state.projectId);
          handle = await pickProjectSaveFile(state.projectId, filename);
          reusedExistingFile = false;
        }
      }

      await writeProjectFile(handle, data);
      markProjectFileSaved(state.projectId, state.updatedAt);
      toast.success(
        reusedExistingFile
          ? `项目空间已覆盖保存，并写入 ${successfulPromptCount} 条成功提示词`
          : `项目空间已保存，并写入 ${successfulPromptCount} 条成功提示词`,
      );
      return;
    } catch (error) {
      console.error("Project save error", error);
    }
  }

  const { saveAs } = await import("file-saver");
  const blob = new Blob([data], { type: "application/json;charset=utf-8" });
  saveAs(blob, filename);
  markProjectFileSaved(state.projectId, state.updatedAt);
  toast.success(`项目空间已导出，并写入 ${successfulPromptCount} 条成功提示词`);
}

export function importProjectFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const result = loadEvent.target?.result;
      if (typeof result !== "string") return;
      useAppStore.getState().loadProjectFromJson(result);
      const state = useAppStore.getState();
      markProjectFileSaved(state.projectId, state.updatedAt);
      toast.success("成功加载项目空间");
    };
    reader.readAsText(file);
  };
  input.click();
}
