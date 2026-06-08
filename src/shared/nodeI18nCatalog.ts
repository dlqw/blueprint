import type { TemplateI18nCatalog } from "./templateI18n";

export const builtinNodeI18nCatalog: TemplateI18nCatalog = {
  "nodeTemplate.builtin.control.entry": {
    name: { "zh-CN": "函数入口" },
    creationPath: { "zh-CN": "控制/函数" },
    description: { "zh-CN": "开始执行 Blueprint 函数。" },
    ports: {
      then: { name: { "zh-CN": "然后" }, description: { "zh-CN": "下一步执行。" } }
    }
  },
  "nodeTemplate.builtin.control.end": {
    name: { "zh-CN": "函数结束" },
    creationPath: { "zh-CN": "控制/函数" },
    description: { "zh-CN": "结束 Blueprint 函数执行。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } }
    }
  },
  "nodeTemplate.builtin.control.branch": {
    name: { "zh-CN": "分支" },
    creationPath: { "zh-CN": "控制/流程" },
    description: { "zh-CN": "根据 true 或 false 路径路由执行。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } },
      condition: { name: { "zh-CN": "条件" }, description: { "zh-CN": "分支条件。" } },
      true: { name: { "zh-CN": "真" }, description: { "zh-CN": "条件为真时的执行路径。" } },
      false: { name: { "zh-CN": "假" }, description: { "zh-CN": "条件为假时的执行路径。" } }
    }
  },
  "nodeTemplate.builtin.control.forRange": {
    name: { "zh-CN": "范围循环" },
    creationPath: { "zh-CN": "控制/循环" },
    description: { "zh-CN": "按数字范围运行循环体。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } },
      start: { name: { "zh-CN": "起始" }, description: { "zh-CN": "第一个索引。" } },
      end: { name: { "zh-CN": "结束" }, description: { "zh-CN": "最后一个索引，不包含。" } },
      index: { name: { "zh-CN": "索引" }, description: { "zh-CN": "当前循环索引。" } },
      loop: { name: { "zh-CN": "循环" }, description: { "zh-CN": "循环体执行。" } },
      completed: { name: { "zh-CN": "完成" }, description: { "zh-CN": "循环完成后的执行。" } }
    }
  },
  "nodeTemplate.builtin.routing.controlHub": {
    name: { "zh-CN": "执行转接点" },
    creationPath: { "zh-CN": "路由" },
    description: { "zh-CN": "用于保持连线清晰的紧凑执行重路由节点。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } },
      then: { name: { "zh-CN": "然后" }, description: { "zh-CN": "下一步执行。" } }
    }
  },
  "nodeTemplate.builtin.routing.dataHub": {
    name: { "zh-CN": "数据转接点" },
    creationPath: { "zh-CN": "路由" },
    description: { "zh-CN": "用于保持连线清晰的紧凑数据重路由节点。" },
    ports: {
      value: { name: { "zh-CN": "值" }, description: { "zh-CN": "被重路由的值。" } },
      out: { name: { "zh-CN": "值" }, description: { "zh-CN": "被重路由的值。" } }
    }
  },
  "nodeTemplate.builtin.blackboard.get": {
    name: { "zh-CN": "读取黑板值" },
    creationPath: { "zh-CN": "黑板" },
    description: { "zh-CN": "读取命名的全局黑板值。" },
    ports: {
      key: { name: { "zh-CN": "键" }, description: { "zh-CN": "黑板变量 ID。" } },
      value: { name: { "zh-CN": "值" }, description: { "zh-CN": "已存储的值。" } }
    }
  },
  "nodeTemplate.builtin.blackboard.set": {
    name: { "zh-CN": "写入黑板值" },
    creationPath: { "zh-CN": "黑板" },
    description: { "zh-CN": "写入命名的全局黑板值。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } },
      key: { name: { "zh-CN": "键" }, description: { "zh-CN": "黑板变量 ID。" } },
      value: { name: { "zh-CN": "值" }, description: { "zh-CN": "要存储的值。" } },
      then: { name: { "zh-CN": "然后" }, description: { "zh-CN": "下一步执行。" } }
    }
  },
  "nodeTemplate.builtin.debug.log": {
    name: { "zh-CN": "日志" },
    creationPath: { "zh-CN": "调试" },
    description: { "zh-CN": "向运行时控制台写入一个值。" },
    ports: {
      exec: { name: { "zh-CN": "执行" }, description: { "zh-CN": "执行输入。" } },
      message: { name: { "zh-CN": "消息" }, description: { "zh-CN": "要输出的消息。" } },
      then: { name: { "zh-CN": "然后" }, description: { "zh-CN": "下一步执行。" } }
    }
  },
  "nodeTemplate.builtin.math.add": {
    name: { "zh-CN": "相加" },
    creationPath: { "zh-CN": "数学/数字" },
    description: { "zh-CN": "将两个数字相加。" },
    ports: {
      a: { name: { "zh-CN": "A" }, description: { "zh-CN": "第一个值。" } },
      b: { name: { "zh-CN": "B" }, description: { "zh-CN": "第二个值。" } },
      result: { name: { "zh-CN": "结果" }, description: { "zh-CN": "A 与 B 的和。" } }
    }
  },
  "nodeTemplate.builtin.math.clamp": {
    name: { "zh-CN": "限制范围" },
    creationPath: { "zh-CN": "数学/数字" },
    description: { "zh-CN": "将数字限制在最小值和最大值之间。" },
    ports: {
      value: { name: { "zh-CN": "值" }, description: { "zh-CN": "输入值。" } },
      min: { name: { "zh-CN": "最小值" }, description: { "zh-CN": "最小值。" } },
      max: { name: { "zh-CN": "最大值" }, description: { "zh-CN": "最大值。" } },
      result: { name: { "zh-CN": "结果" }, description: { "zh-CN": "限制后的结果。" } }
    }
  },
  "nodeTemplate.builtin.string.concat": {
    name: { "zh-CN": "拼接" },
    creationPath: { "zh-CN": "字符串" },
    description: { "zh-CN": "拼接两个字符串。" },
    ports: {
      a: { name: { "zh-CN": "A" }, description: { "zh-CN": "第一个字符串。" } },
      b: { name: { "zh-CN": "B" }, description: { "zh-CN": "第二个字符串。" } },
      result: { name: { "zh-CN": "结果" }, description: { "zh-CN": "合并后的字符串。" } }
    }
  },
  "nodeTemplate.builtin.json.stringify": {
    name: { "zh-CN": "JSON 字符串化" },
    creationPath: { "zh-CN": "JSON" },
    description: { "zh-CN": "将值转换为 JSON 字符串。" },
    ports: {
      value: { name: { "zh-CN": "值" }, description: { "zh-CN": "要字符串化的值。" } },
      result: { name: { "zh-CN": "结果" }, description: { "zh-CN": "JSON 字符串。" } }
    }
  }
};
