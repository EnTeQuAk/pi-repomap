; Reference tag extraction for C#.

; Method/function calls
(invocation_expression
  function: (identifier) @name.reference)

(invocation_expression
  function: (member_access_expression
    name: (identifier) @name.reference))

; new Foo()
(object_creation_expression
  type: (identifier) @name.reference)

; Type references in declarations
(base_list
  (identifier) @name.reference)

(generic_name
  (identifier) @name.reference)
