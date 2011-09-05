use NQPP6Regex;

# This powers the optimization pass. It takes place after we've done all
# of the stuff in the grammar and actions, which means CHECK time is over.
# Thus we're allowed to assume that lexpads are immutable, declarations are
# over and done with, multi candidate lists won't change and so forth.
class Perl6::Optimizer {
    has @!block_stack;
    has $!pres_topic_counter;
    
    # Entry point for the optimization process.
    method optimize($past, *%adverbs) {
        # Initialize.
        @!block_stack := [$past];
        $!pres_topic_counter := 0;
        
        # We'll start walking over UNIT (we wouldn't find it by going
        # over OUTER since we don't walk loadinits).
        my $unit := $past<UNIT>;
        unless $unit.isa(PAST::Block) {
            pir::die("Optimizer could not find UNIT");
        }
        self.visit_block($unit);
        $past
    }
    
    # Called when we encounter a block in the tree.
    method visit_block($block) {
        # Push block onto block stack.
        @!block_stack.push($block);
        
        # Visit children.
        self.visit_children($block);
        
        # Pop block from block stack.
        @!block_stack.pop();
        
        # If the block is immediate, we may be able to inline it.
        if $block.blocktype eq 'immediate' {
            my $outer := @!block_stack[+@!block_stack - 1];

            # Scan symbols for any non-interesting ones.
            # XXX Shouldn't have to care about $/ and $! here...
            my @sigsyms;
            for $block.symtable() {
                my $name := $_.key;
                if $name ne '$/' && $name ne '$!' && $name ne '$_' && $name ne 'call_sig' {
                    @sigsyms.push($name);
                }
            }
            
            # If we have no interesting ones, then we can inline the
            # statements.
            # XXX We can also check for lack of colliding symbols and
            # do something in that case. However, it's non-trivial as
            # the static lexpad entries will need twiddling with.
            if +@sigsyms == 0 {
                return self.inline_immediate_block($block, $outer);
            }
        }
        
        $block
    }
    
    # Called when we encounter a PAST::Op in the tree. Produces either
    # the op itself or some replacement opcode to put in the tree.
    method visit_op($op) {
        # Calls are especially interesting as we may wish to do some
        # kind of inlining.
        my $pasttype := $op.pasttype;
        if ($pasttype eq 'call' || $pasttype eq '') && $op.name ne '' {
            # See if we can find the thing we're going to call.
            my $obj;
            my $found;
            try {
                $obj := self.find_lexical($op.name);
                $found := 1;
            }
            if $found {
                # If it's an onlystar proto, we can avoid the overhead
                # of actually doing the proto call.
                my $dispatcher;
                try { if $obj.is_dispatcher { $dispatcher := 1 } }
                if $dispatcher {
                    self.visit_children($op);
                    return self.inline_proto($op, $obj);
                }
            }
        }
        
        # If we end up here, just visit children and leave op as is.
        self.visit_children($op);
        $op
    }
    
    # Visits all of a nodes children, and dispatches appropriately.
    method visit_children($node) {
        my $i := 0;
        while $i < +@($node) {
            my $visit := $node[$i];
            unless pir::isa($visit, 'String') || pir::isa($visit, 'Integer') {
                if $visit.isa(PAST::Op) {
                    $node[$i] := self.visit_op($visit)
                }
                elsif $visit.isa(PAST::Block) {
                    $node[$i] := self.visit_block($visit);
                }
                elsif $visit.isa(PAST::Stmts) {
                    self.visit_children($visit);
                }
                elsif $visit.isa(PAST::Stmt) {
                    self.visit_children($visit);
                }
            }
            $i := $i + 1;
        }
    }
    
    # Locates a lexical symbol and returns it. Dies if it does not exist.
    method find_lexical($name) {
        my $i := +@!block_stack;
        while $i > 0 {
            $i := $i - 1;
            my $block := @!block_stack[$i];
            my %sym := $block.symbol($name);
            if +%sym {
                if pir::exists(%sym, 'value') {
                    return %sym<value>;
                }
                else {
                    pir::die("Optimizer: No lexical compile time value for $name");
                }
            }
        }
        pir::die("Optimizer: No lexical $name found");
    }
    
    # Inlines an immediate block.
    method inline_immediate_block($block, $outer) {
        # Extract interesting parts of block.
        my $decls := $block.shift;
        my $stmts := $block.shift;
        
        # Turn block into an "optimized out" stub (deserialization
        # or fixup will still want it to be there).
        $block.blocktype('declaration');
        $block[0] := PAST::Op.new( :pirop('die vs'),
            'INTERNAL ERROR: Execution of block eliminated by optimizer');                
        $outer[0].push($block);
        
        # Copy over interesting stuff in declaration section.
        for @($decls) {
            if $_.isa(PAST::Op) && $_.pirop eq 'bind_signature vP' {
                # Don't copy this binder call.
            }
            elsif $_.isa(PAST::Var) && ($_.name eq '$/' || $_.name eq '$!' ||
                    $_.name eq '$_' || $_.name eq 'call_sig') {
                # Don't copy this variable node.
            }
            else {
                $outer[0].push($_);
            }
        }
        
        # Hand back the statements, but be sure to preserve $_
        # around them.
        $!pres_topic_counter := $!pres_topic_counter + 1;
        $outer[0].push(PAST::Var.new( :scope('register'),
            :name("pres_topic_$!pres_topic_counter"), :isdecl(1) ));
        return PAST::Stmts.new(
            PAST::Op.new( :pasttype('bind_6model'),
                PAST::Var.new( :name("pres_topic_$!pres_topic_counter"), :scope('register') ),
                PAST::Var.new( :name('$_'), :scope('lexical') )
            ),
            $stmts,
            PAST::Op.new( :pasttype('bind_6model'),
                PAST::Var.new( :name('$_'), :scope('lexical') ),
                PAST::Var.new( :name("pres_topic_$!pres_topic_counter"), :scope('register') )
            )
        );
    }
    
    # Inlines a proto.
    method inline_proto($call, $proto) {
        #say("# found proto to inline");
        $call
    }
}
