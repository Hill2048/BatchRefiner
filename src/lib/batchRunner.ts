import { useAppStore } from '@/store';
import { generatePromptForTask, runImageGenerationMode } from './ai';
import pLimit from 'p-limit';
import { toast } from 'sonner';

export async function generateTaskPrompt(taskId: string) {
  const store = useAppStore.getState();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return;

  try {
    store.updateTask(taskId, { status: 'Prompting' });
    const prompt = await generatePromptForTask(task, store);
    store.updateTask(taskId, { 
      promptText: prompt, 
      promptSource: 'auto',
      status: 'Idle' // Goes back to ready to run
    });
  } catch (error: any) {
    store.updateTask(taskId, { 
      status: 'Error',
      errorLog: {
        stage: 'Prompt Generation',
        message: error.message || 'Unknown error',
        createdAt: Date.now(),
        retryCount: (task.errorLog?.retryCount || 0) + 1
      }
    });
    throw error;
  }
}

export async function processSingleTask(taskId: string, maxRetries = 2, mode: 'all' | 'prompts' | 'images' = 'all') {
  let attempt = 0;
  
  while (attempt <= maxRetries) {
    const store = useAppStore.getState();
    let task = store.tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      // Dispatch scroll event for auto-focus during batch
      window.dispatchEvent(new CustomEvent('scroll-to-task', { detail: taskId }));

      // 1. Check if needs prompt
      if (mode === 'all' || mode === 'prompts') {
        if (!task.promptText) {
          await generateTaskPrompt(taskId);
          task = useAppStore.getState().tasks.find(t => t.id === taskId);
          if (!task || task.status === 'Error') throw new Error("Prompt generation failed.");
        }
      }

      if (mode === 'prompts') {
         return; // We only needed to generate prompt
      }

      // 2. Run Image Gen
      if (mode === 'all' || mode === 'images') {
        if (!task.promptText) throw new Error("No prompt available");
        
        store.updateTask(taskId, { status: 'Rendering' });
        const imageUrl = await runImageGenerationMode(task, store);
        
        store.updateTask(taskId, { 
           status: 'Success', 
           resultImage: imageUrl,
           errorLog: undefined // clear error
        });
        return; // break out of retry loop
      }
    } catch (error: any) {
      attempt++;
      store.updateTask(taskId, { 
        status: 'Error',
        errorLog: {
          stage: 'Image Generation',
          message: error.message || 'Unknown error',
          createdAt: Date.now(),
          retryCount: attempt
        }
      });
      if (attempt > maxRetries) {
         toast.error(`任务 ${taskId.substring(0,4)} 图片生成连续失败`);
         break;
      }
      // short delay before retry
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

export async function processBatch(mode: 'all' | 'prompts' | 'images' = 'all') {
  const store = useAppStore.getState();
  if (store.isBatchRunning) return; // already running

  // Request notification permission if not yet granted/denied
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(console.warn);
    }
  }

  store.setBatchRunning(true);
  
  // Use p-limit to respect the user's maxConcurrency setting
  const limit = pLimit(store.maxConcurrency || 3);
  
  let tasksToRun = [];
  if (store.selectedTaskIds.length > 0) {
     tasksToRun = store.tasks.filter(t => store.selectedTaskIds.includes(t.id) && t.status !== 'Success');
  } else {
     if (mode === 'images') {
       tasksToRun = store.tasks.filter(t => (t.status === 'Idle' || t.status === 'Waiting') && !!t.promptText);
     } else {
       tasksToRun = store.tasks.filter(t => t.status === 'Idle' || t.status === 'Waiting');
     }
  }
  
  if (tasksToRun.length === 0) {
    store.setBatchRunning(false);
    return;
  }

  const promises = tasksToRun.map(task => limit(async () => {
    // Only process if batch is still running
    if (!useAppStore.getState().isBatchRunning) return;
    await processSingleTask(task.id, 2, mode);
  }));

  await Promise.allSettled(promises);
  
  // Issue system notification if completed
  if (useAppStore.getState().isBatchRunning) { 
    // Means it wasn't manually cancelled
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
       try {
         new Notification('任务队列处理完毕', {
            body: `已完成队列中的 ${tasksToRun.length} 个生成任务。`,
            icon: '/vite.svg'
         });
       } catch (err) {
         console.warn("System notification failed:", err);
       }
    }
    toast.success(`批量执行已完成 (${tasksToRun.length} 个任务)`);
  }

  useAppStore.getState().setBatchRunning(false);
}

export function haltBatch() {
  const store = useAppStore.getState();
  store.setBatchRunning(false);
  
  // Also reset any Rendering/Prompting tasks back to Idle or Error
  // so they don't appear stuck visually.
  const tasks = store.tasks;
  tasks.forEach(t => {
    if (t.status === 'Rendering' || t.status === 'Prompting') {
      store.updateTask(t.id, { 
        status: 'Error',
        errorLog: {
          stage: 'Batch Cancelled',
          message: '用户手动终止了队列执行',
          createdAt: Date.now(),
          retryCount: 0
        }
      });
    }
  });

  toast.info("已终止正在执行的所有任务列队。");
}
