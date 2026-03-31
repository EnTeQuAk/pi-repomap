; pi-repomap outline query for JavaScript.
; Derived from Zed's outline.scm, trimmed for repo map use.

(internal_module
  "namespace" @context
  name: (_) @name) @item

(enum_declaration
  "enum" @context
  name: (_) @name) @item

(function_declaration
  "async"? @context
  "function" @context
  name: (_) @name
  parameters: (formal_parameters
    "(" @context
    ")" @context)) @item

(generator_function_declaration
  "async"? @context
  "function" @context
  "*" @context
  name: (_) @name
  parameters: (formal_parameters
    "(" @context
    ")" @context)) @item

(interface_declaration
  "interface" @context
  name: (_) @name) @item

; Exported const/let
(program
  (export_statement
    (lexical_declaration
      [
        "let"
        "const"
      ] @context
      (variable_declarator
        name: (identifier) @name) @item)))

; Top-level const/let
(program
  (lexical_declaration
    [
      "let"
      "const"
    ] @context
    (variable_declarator
      name: (identifier) @name) @item))

(class_declaration
  "class" @context
  name: (_) @name) @item

; Methods in classes
(class_body
  (method_definition
    [
      "get"
      "set"
      "async"
      "*"
      "readonly"
      "static"
      (override_modifier)
      (accessibility_modifier)
    ]* @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item)

; Class fields
(public_field_definition
  [
    "declare"
    "readonly"
    "abstract"
    "static"
    (accessibility_modifier)
  ]* @context
  name: (_) @name) @item

; Test blocks
((call_expression
  function: [
    (identifier) @_name
    (member_expression
      object: [
        (identifier) @_name
        (member_expression
          object: (identifier) @_name)
      ])
  ] @context
  (#any-of? @_name "it" "test" "describe" "context" "suite")
  arguments: (arguments
    .
    [
      (string
        (string_fragment) @name)
      (identifier) @name
    ]))) @item

(comment) @annotation
