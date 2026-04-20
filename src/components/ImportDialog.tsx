import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { useState } from 'react';
import { useAppStore } from '@/store';
import Papa from 'papaparse';
import { toast } from 'sonner';

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeTab, setActiveTab] = useState<string>('csv');
  const [csvInput, setCsvInput] = useState('');
  const [listInput, setListInput] = useState('');
  const importTasks = useAppStore(state => state.importTasks);
  const tasksCount = useAppStore(state => state.tasks.length);

  const handleImport = () => {
    let imported = 0;
    if (activeTab === 'csv' && csvInput.trim()) {
      imported = parseCsv(csvInput);
    } else if (activeTab === 'list' && listInput.trim()) {
      imported = parseList(listInput);
    }

    if (imported > 0) {
      toast.success(`成功导入 ${imported} 个任务`);
      onOpenChange(false);
      setCsvInput('');
      setListInput('');
    } else {
      toast.error('导入失败，请检查输入格式。');
    }
  };

  const parseCsv = (input: string) => {
    const results = Papa.parse(input, { header: true, skipEmptyLines: true });
    if (results.errors.length > 0 || !results.data || results.data.length === 0) return 0;
    
    const firstRow = results.data[0] as any;
    const cols = Object.keys(firstRow);
    const titleCol = cols.find(c => c.toLowerCase().includes('name') || c.toLowerCase().includes('title') || c.includes('名称') || c.includes('标题')) || cols[0];
    const descCol = cols.find(c => c.toLowerCase().includes('desc') || c.includes('描述') || c.includes('提示词') || c.includes('prompt')) || cols[1] || cols[0];

    const tasksToImport = results.data.map((row: any, i: number) => ({
       index: tasksCount + i + 1,
       title: row[titleCol] || `任务 ${tasksCount + i + 1}`,
       description: row[descCol] || '',
       referenceImages: [],
    }));
    
    importTasks(tasksToImport);
    return tasksToImport.length;
  };

  const parseList = (input: string) => {
    const lines = input.split('\n').filter(l => l.trim().length > 0);
    const tasksToImport = lines.map((line, i) => ({
        index: tasksCount + i + 1,
        title: line.substring(0, 50) + (line.length > 50 ? '...' : ''),
        description: line,
        referenceImages: [],
    }));
    importTasks(tasksToImport);
    return tasksToImport.length;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-card border border-border/60 rounded-[20px] claude-shadow p-0 overflow-hidden">
        <DialogHeader className="px-8 pt-8 pb-4">
          <DialogTitle className="font-serif text-[23.1px] font-medium text-foreground tracking-tight">导入任务</DialogTitle>
          <div className="text-[13.65px] text-text-secondary mt-1">在下方粘贴数据以自动生成批量任务。</div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-8 flex items-center justify-between border-b border-border/60">
            <TabsList className="bg-transparent h-12 p-0 border-none space-x-6">
              <TabsTrigger value="csv" className="font-medium text-[13.65px] rounded-none border-b-2 border-transparent data-[state=active]:border-button-main data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground bg-transparent text-text-secondary w-auto px-0 h-12">从表格复制 (CSV/Excel)</TabsTrigger>
              <TabsTrigger value="list" className="font-medium text-[13.65px] rounded-none border-b-2 border-transparent data-[state=active]:border-button-main data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground bg-transparent text-text-secondary w-auto px-0 h-12">纯文本列表</TabsTrigger>
            </TabsList>
            
            <Badge variant="outline" className="font-mono text-[10.5px] bg-[#F5F4F0] border-none text-text-secondary uppercase">自动映射列名</Badge>
          </div>

          <div className="p-8">
            <TabsContent value="csv" className="mt-0 outline-none">
              <div className="flex flex-col gap-4">
                <Textarea 
                  placeholder="在此处粘贴包含表头的表格数据...&#10;自动提取【标题】和【提示词】"
                  className="h-[250px] font-mono text-[13.65px] bg-[#F5F4F0] border border-border/60 rounded-xl resize-none shadow-none focus-visible:ring-1 focus-visible:ring-button-main p-4"
                  value={csvInput}
                  onChange={e => setCsvInput(e.target.value)}
                />
              </div>
            </TabsContent>
            <TabsContent value="list" className="mt-0 outline-none">
               <div className="flex flex-col gap-4">
                <Textarea 
                  placeholder="在此处粘贴文本列表，每一行将作为独立的一个任务...&#10;例如：&#10;将背景改成红色&#10;添加赛博朋克特效"
                  className="h-[250px] text-[13.65px] bg-[#F5F4F0] border border-border/60 rounded-xl resize-none shadow-none focus-visible:ring-1 focus-visible:ring-button-main p-4"
                  value={listInput}
                  onChange={e => setListInput(e.target.value)}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="px-8 py-5 border-t border-border/60 bg-[#F5F4F0]/50 flex justify-end gap-3 mt-auto">
           <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 hover:bg-[#E8E5DF] rounded-full text-[13.65px] font-medium text-text-secondary px-6 transition-all">取消</Button>
           <Button onClick={handleImport} className="h-9 rounded-full bg-button-main text-[#F2EFEB] hover:bg-[#333230] px-6 shadow-sm text-[13.65px] font-medium transition-all">确认导入</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
