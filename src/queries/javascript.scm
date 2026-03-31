; pi-repomap outline query for JavaScript.
; Adapted from Zed's outline.scm, removing TypeScript-only node types
; (override_modifier, accessibility_modifier) that don't exist in the
; JavaScript grammar.

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

; Methods in classes (JS has no override/accessibility modifiers)
(class_body
  (method_definition
    [
      "get"
      "set"
      "async"
      "*"
      "static"
    ]* @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item)

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
