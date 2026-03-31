; pi-repomap outline query for C#.
; Derived from Zed's outline.scm, trimmed for repo map use.
;
; Source: https://github.com/zed-extensions/csharp (zed-extensions/csharp)

(namespace_declaration
  "namespace" @context
  name: (_) @name) @item

(file_scoped_namespace_declaration
  "namespace" @context
  name: (_) @name) @item

(class_declaration
  "class" @context
  name: (identifier) @name) @item

(class_declaration
  name: (identifier) @name
  (base_list
    (identifier) @inherit)) @item

(interface_declaration
  "interface" @context
  name: (identifier) @name) @item

(interface_declaration
  name: (identifier) @name
  (base_list
    (identifier) @inherit)) @item

(struct_declaration
  "struct" @context
  name: (identifier) @name) @item

(enum_declaration
  "enum" @context
  name: (identifier) @name) @item

(record_declaration
  "record" @context
  name: (identifier) @name) @item

(method_declaration
  name: (identifier) @name
  parameters: (parameter_list) @context) @item

(constructor_declaration
  name: (identifier) @name) @item

(property_declaration
  name: (identifier) @name) @item

(delegate_declaration
  "delegate" @context
  name: (identifier) @name) @item
