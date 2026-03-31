(decorator) @annotation

(class_definition
  "class" @context
  name: (identifier) @name) @item

(class_definition
  name: (identifier) @name
  superclasses: (argument_list
    (identifier) @inherit)) @item

(function_definition
  "async"? @context
  "def" @context
  name: (_) @name) @item
