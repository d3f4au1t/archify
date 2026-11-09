import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.tools.*;
import java.nio.file.*;
import java.util.*;
import java.io.*;

/** Parse declarations and call sites without compiling or executing project code. */
class IndexJava {
    static Map<String,Object> obj(Object... pairs) {
        var map = new LinkedHashMap<String,Object>();
        for (int i=0; i<pairs.length; i+=2) map.put((String)pairs[i], pairs[i+1]);
        return map;
    }
    static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof String s) {
            var out=new StringBuilder("\"");
            for(char c:s.toCharArray()) {
                switch(c) {case '"':out.append("\\\"");break;case '\\':out.append("\\\\");break;
                    case '\n':out.append("\\n");break;case '\r':out.append("\\r");break;case '\t':out.append("\\t");break;
                    default:if(c<32)out.append(String.format("\\u%04x",(int)c));else out.append(c);}
            }
            return out.append('"').toString();
        }
        if (value instanceof Map<?,?> m) {var a=new ArrayList<String>();m.forEach((k,v)->a.add(json(k.toString())+":"+json(v)));return "{"+String.join(",",a)+"}";}
        if (value instanceof Collection<?> a) {var b=new ArrayList<String>();a.forEach(v->b.add(json(v)));return "["+String.join(",",b)+"]";}
        return value.toString();
    }
    public static void main(String[] args) throws Exception {
        var root=Path.of(args[0]).toAbsolutePath();
        var compiler=ToolProvider.getSystemJavaCompiler();
        if(compiler==null) throw new IllegalStateException("A JDK is required for Java indexing.");
        var diagnostics=new DiagnosticCollector<JavaFileObject>();
        try(var manager=compiler.getStandardFileManager(diagnostics,null,java.nio.charset.StandardCharsets.UTF_8)) {
            List<File> inputs;
            try(var paths=Files.walk(root)){inputs=paths.filter(p->p.toString().endsWith(".java")).sorted().map(Path::toFile).toList();}
            var task=(JavacTask)compiler.getTask(null,manager,diagnostics,List.of("-proc:none"),null,manager.getJavaFileObjectsFromFiles(inputs));
            var units=task.parse();
            var trees=Trees.instance(task);
            var positions=trees.getSourcePositions();
            var files=new ArrayList<Object>();var classes=new ArrayList<Object>();var methods=new ArrayList<Object>();
            for(var unit:units) {
                var path=root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace(File.separatorChar,'/');
                var source=Files.readString(Path.of(unit.getSourceFile().toUri()));
                var pkg=unit.getPackageName()==null?"":unit.getPackageName().toString();
                var imports=new ArrayList<Object>();
                for(var imp:unit.getImports()) imports.add(obj("name",imp.getQualifiedIdentifier().toString(),"static",imp.isStatic(),"line",unit.getLineMap().getLineNumber(positions.getStartPosition(unit,imp))));
                files.add(obj("path",path,"package",pkg,"imports",imports));
                new TreePathScanner<Void,Void>() {
                    Map<String,Object> owner=null, method=null;
                    int lambda=0;
                    long line(Tree tree){return unit.getLineMap().getLineNumber(Math.max(0,positions.getStartPosition(unit,tree)));}
                    long end(Tree tree){return unit.getLineMap().getLineNumber(Math.max(0,positions.getEndPosition(unit,tree)-1));}
                    String snippet(Tree tree){long a=positions.getStartPosition(unit,tree),b=positions.getEndPosition(unit,tree);return a>=0&&b>=a?source.substring((int)a,(int)b):tree.toString();}
                    @SuppressWarnings("unchecked") List<Object> list(Map<String,Object> map,String key){return (List<Object>)map.get(key);}
                    public Void visitClass(ClassTree tree,Void v) {
                        var prior=owner;var priorMethod=method;
                        String name=tree.getSimpleName().toString();
                        if(name.isEmpty())name="anonymous@"+line(tree)+":"+positions.getStartPosition(unit,tree);
                        String qualified=(owner==null?(pkg.isEmpty()?"":pkg+"."):owner.get("qualified")+".")+name;
                        var supers=new ArrayList<String>();
                        if(tree.getExtendsClause()!=null)supers.add(tree.getExtendsClause().toString());
                        tree.getImplementsClause().forEach(t->supers.add(t.toString()));
                        owner=obj("id",path+"#"+qualified+"@"+line(tree),"path",path,"name",name,"qualified",qualified,"line",line(tree),"endLine",end(tree),"supers",supers,"fields",new ArrayList<Object>(),"parent",prior==null?null:prior.get("id"));
                        classes.add(owner);method=null;
                        super.visitClass(tree,v);owner=prior;method=priorMethod;return null;
                    }
                    public Void visitMethod(MethodTree tree,Void v) {
                        if(owner==null)return null;
                        var prior=method;
                        String name=tree.getName().toString();boolean ctor=name.equals("<init>");
                        if(ctor)name=owner.get("name").toString();
                        var params=new ArrayList<Object>();
                        tree.getParameters().forEach(p->params.add(obj("name",p.getName().toString(),"type",p.getType().toString())));
                        String signature=snippet(tree);int body=tree.getBody()==null?-1:(int)(positions.getStartPosition(unit,tree.getBody())-positions.getStartPosition(unit,tree));
                        if(body>=0)signature=signature.substring(0,body);
                        signature=signature.replaceAll("\\s+"," ").trim();
                        String doc=trees.getDocComment(getCurrentPath());
                        method=obj("id",path+"#"+owner.get("qualified")+"."+name+"@"+line(tree)+":"+positions.getStartPosition(unit,tree),"path",path,"owner",owner.get("id"),"name",name,"constructor",ctor,"signature",signature,"returnType",tree.getReturnType()==null?null:tree.getReturnType().toString(),"line",line(tree),"endLine",end(tree),"params",params,"variables",new ArrayList<Object>(),"calls",new ArrayList<Object>(),"doc",doc==null?"":doc.trim());
                        methods.add(method);super.visitMethod(tree,v);method=prior;return null;
                    }
                    public Void visitVariable(VariableTree tree,Void v) {
                        if(owner!=null && tree.getType()!=null) {
                            TreePath scope=getCurrentPath().getParentPath();
                            boolean field=scope!=null&&scope.getLeaf() instanceof ClassTree;
                            while(scope!=null && !(scope.getLeaf() instanceof BlockTree) && !(scope.getLeaf() instanceof MethodTree) && !(scope.getLeaf() instanceof ClassTree) && !(scope.getLeaf() instanceof ForLoopTree) && !(scope.getLeaf() instanceof EnhancedForLoopTree) && !(scope.getLeaf() instanceof CatchTree))scope=scope.getParentPath();
                            var item=obj("name",tree.getName().toString(),"type",tree.getType().toString(),"line",line(tree),"scopeEnd",scope==null?end(tree):end(scope.getLeaf()));
                            if(field)list(owner,"fields").add(item);else if(method!=null)list(method,"variables").add(item);
                        }
                        return super.visitVariable(tree,v);
                    }
                    public Void visitLambdaExpression(LambdaExpressionTree tree,Void v){lambda++;super.visitLambdaExpression(tree,v);lambda--;return null;}
                    public Void visitMethodInvocation(MethodInvocationTree tree,Void v) {
                        if(method!=null) {
                            var select=tree.getMethodSelect();String name=select.toString(),receiver="";
                            if(select instanceof MemberSelectTree s){name=s.getIdentifier().toString();receiver=s.getExpression().toString();}
                            list(method,"calls").add(obj("name",name,"receiver",receiver,"arity",tree.getArguments().size(),"line",line(tree),"text",snippet(tree),"callback",lambda>0,"constructor",false));
                        }
                        return super.visitMethodInvocation(tree,v);
                    }
                    public Void visitNewClass(NewClassTree tree,Void v) {
                        if(method!=null)list(method,"calls").add(obj("name",tree.getIdentifier().toString(),"receiver",tree.getIdentifier().toString(),"arity",tree.getArguments().size(),"line",line(tree),"text",snippet(tree),"callback",lambda>0,"constructor",true));
                        return super.visitNewClass(tree,v);
                    }
                    public Void visitMemberReference(MemberReferenceTree tree,Void v) {
                        if(method!=null)list(method,"calls").add(obj("name",tree.getName().toString(),"receiver",tree.getQualifierExpression().toString(),"arity",-1,"line",line(tree),"text",snippet(tree),"callback",true,"constructor",false,"reference",true));
                        return super.visitMemberReference(tree,v);
                    }
                }.scan(unit,null);
            }
            var errors=diagnostics.getDiagnostics().stream().filter(d->d.getKind()==Diagnostic.Kind.ERROR).map(d->obj("file",d.getSource()==null?"":root.relativize(Path.of(d.getSource().toUri())).toString(),"line",d.getLineNumber(),"message",d.getMessage(Locale.ROOT))).toList();
            System.out.println(json(obj("files",files,"classes",classes,"methods",methods,"errors",errors)));
            if(!errors.isEmpty())System.exit(1);
        }
    }
}
