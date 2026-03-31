; pi-repomap outline query for Dart/Flutter.
; Derived from Zed's outline.scm, extended for Flutter patterns.
;
; Source: https://github.com/zed-extensions/dart (extended)

; Classes: base pattern plus inheritance patterns that repeat @name
; and @item so the parser can merge context captures across matches.
(class_definition
  "class" @context
  name: (_) @name) @item

(class_definition
  name: (_) @name
  superclass: (superclass
    (type_identifier) @inherit)) @item

(class_definition
  name: (_) @name
  interfaces: (interfaces
    (type_identifier) @inherit)) @item

(mixin_declaration
  "mixin" @context
  name: (_) @name) @item

(extension_declaration
  "extension" @context
  name: (_) @name) @item

(enum_declaration
  "enum" @context
  name: (_) @name) @item

(type_alias
  (type_identifier) @name) @item

; Methods: match the outer method_signature to avoid duplicates
; with function_signature (which also matches inside method_signature)
(method_signature
  (function_signature
    name: (_) @name)) @item

; Top-level functions only (not inside class bodies)
(program
  (function_signature
    name: (_) @name) @item)

(getter_signature
  "get" @context
  name: (_) @name) @item

(setter_signature
  "set" @context
  name: (_) @name) @item

(constructor_signature
  name: (_) @name) @item

; Top-level constants and variables
(static_final_declaration
  (identifier) @name) @item

(initialized_identifier
  (identifier) @name) @item
