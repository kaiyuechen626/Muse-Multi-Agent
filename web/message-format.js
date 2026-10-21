// SPDX-License-Identifier: GPL-3.0-or-later
// Deliberately small Markdown subset. Never interpret message text as HTML.
export function messageBlocks(text){
  const lines=text.replace(/\r\n?/g,'\n').split('\n'),blocks=[];
  for(let i=0;i<lines.length;){
    const line=lines[i],fence=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if(fence){
      const code=[],marker=fence[1][0],length=fence[1].length;i++;
      while(i<lines.length&&!new RegExp(`^\\s{0,3}${marker}{${length},}\\s*$`).test(lines[i]))code.push(lines[i++]);
      if(i<lines.length)i++;
      blocks.push({type:'code',language:fence[2].trim(),text:code.join('\n')});continue;
    }
    if(!line.trim()){i++;continue;}
    const heading=line.match(/^(#{1,6})\s+(.+)$/),quote=line.match(/^>\s?(.*)$/),list=line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if(heading)blocks.push({type:'heading',level:heading[1].length,text:heading[2]});
    else if(quote)blocks.push({type:'quote',text:quote[1]});
    else if(list)blocks.push({type:'list',ordered:/^\d/.test(list[1]),number:parseInt(list[1],10),text:list[2]});
    else blocks.push({type:'paragraph',text:line});
    i++;
  }
  return blocks;
}
function inline(parent,text){
  const pattern=/(`+)([^`]*?)\1|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;let offset=0;
  for(const m of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(offset,m.index)));
    const el=document.createElement(m[1]?'code':m[3]?'strong':'em');el.textContent=m[2]??m[3]??m[4];parent.append(el);offset=m.index+m[0].length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}
export function formatMessage(text){
  const root=document.createElement('div');root.className='messageBody';let list=null;
  for(const block of messageBlocks(text)){
    if(block.type!=='list')list=null;
    if(block.type==='code'){
      const box=document.createElement('section'),bar=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button'),pre=document.createElement('pre'),code=document.createElement('code');
      box.className='codeBlock';bar.className='codeBar';label.textContent=block.language||'代码';button.type='button';button.textContent='复制代码';
      button.onclick=async()=>{try{await navigator.clipboard.writeText(block.text);button.textContent='已复制';}catch{button.textContent='复制失败，请手动选择';}};
      code.textContent=block.text;pre.append(code);bar.append(label,button);box.append(bar,pre);root.append(box);continue;
    }
    if(block.type==='list'){
      const tag=block.ordered?'OL':'UL';if(list?.tagName!==tag){list=document.createElement(tag);if(block.ordered)list.start=block.number;root.append(list);}
      const li=document.createElement('li');inline(li,block.text);list.append(li);continue;
    }
    const el=document.createElement(block.type==='heading'?`h${Math.min(6,block.level+2)}`:block.type==='quote'?'blockquote':'p');inline(el,block.text);root.append(el);
  }
  return root;
}
