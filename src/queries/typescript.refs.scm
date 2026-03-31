; Reference tag extraction for TypeScript.
; Captures identifier usages (calls, type references, instantiations)
; for cross-file ranking. Derived from aider's tags.scm.

; Function/method calls
(call_expression
  function: (identifier) @name.reference)

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference))

; Type references in annotations
(type_annotation
  (type_identifier) @name.reference)

; new Foo()
(new_expression
  constructor: (identifier) @name.reference)

; Extends clause: class Foo extends Bar
(extends_clause
  value: (identifier) @name.reference)

; Implements clause: class Foo implements Bar
(implements_clause
  (type_identifier) @name.reference)

; Generic type arguments: Foo<Bar>
(type_arguments
  (type_identifier) @name.reference)
